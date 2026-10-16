import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error.js';
import { AdminManagementService } from './admin-management.service.js';
import { revokeDeletedSubject } from '../../auth/services/deleted-subjects.js';

export const deletionModuleSchema = z.enum([
  'users',
  'drivers',
  'admins',
  'partners',
  'vehicles',
  'vehicle-types',
  'coupons',
]);
type Module = z.infer<typeof deletionModuleSchema>;
const permission = {
  users: 'users',
  drivers: 'drivers',
  admins: 'admins',
  partners: 'partners',
  vehicles: 'vehicles',
  'vehicle-types': 'pricing',
  coupons: 'coupons',
} as const;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const conflict = () =>
  new AppError(
    'DELETE_DEPENDENCY_CONFLICT',
    'This record has documents, operational history or dependent records. Remove eligible associations first; retained business history cannot be deleted here.',
    409,
  );

export class RecordDeletionService {
  private access: AdminManagementService;
  constructor(private database: Pool) {
    this.access = new AdminManagementService(database);
  }

  // Guard even ON DELETE CASCADE/SET NULL relationships: deleting a master record
  // must never silently erase documents, financial ledgers or operational history.
  private async assertUnreferenced(client: PoolClient, table: string, id: string) {
    const refs = await client.query<{ schema: string; table: string; column: string }>(
      `SELECT n.nspname AS schema,t.relname AS table,a.attname AS column
       FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
       CROSS JOIN LATERAL unnest(c.conkey,c.confkey) AS k(child,parent)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.child
       JOIN pg_attribute p ON p.attrelid=c.confrelid AND p.attnum=k.parent
       WHERE c.contype='f' AND c.confrelid=('public.'||$1)::regclass AND p.attname='id'`,
      [table],
    );
    for (const ref of refs.rows) {
      const result = await client.query(
        `SELECT 1 FROM ${quote(ref.schema)}.${quote(ref.table)} WHERE ${quote(ref.column)}=$1 LIMIT 1`,
        [id],
      );
      if (result.rowCount) throw conflict();
    }
  }

  private async clearUnreviewedRequest(client: PoolClient, kind: string, id: string) {
    await client.query(
      `DELETE FROM provider_approval_requests WHERE target_type=$1 AND target_id=$2 AND reviewer_id IS NULL AND status IN ('PENDING','CANCELLED','EXPIRED')`,
      [kind, id],
    );
    if (
      (
        await client.query(
          'SELECT 1 FROM provider_approval_requests WHERE target_type=$1 AND target_id=$2 LIMIT 1',
          [kind, id],
        )
      ).rowCount
    )
      throw conflict();
  }

  private async deleteProfile(
    client: PoolClient,
    table: 'driver_profiles' | 'partners',
    userId: string,
  ) {
    const found = await client.query(`SELECT * FROM ${table} WHERE user_id=$1 FOR UPDATE`, [
      userId,
    ]);
    const row = found.rows[0];
    if (!row) return;
    if (Object.entries(row).some(([key, value]) => /(?:document|photo)_key$/.test(key) && value))
      throw conflict();
    await this.clearUnreviewedRequest(
      client,
      table === 'partners' ? 'partner' : 'driver_profile',
      row.id,
    );
    await this.assertUnreferenced(client, table, row.id);
    await client.query(`DELETE FROM ${table} WHERE id=$1`, [row.id]);
  }

  async remove(actorId: string, actorRole: string, module: Module, id: string) {
    const client = await this.database.connect();
    let deletedSubjectId: string | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM users WHERE id=$1 FOR SHARE`, [actorId]);
      const actor = await this.access.identity(actorId, actorRole);
      const requirePermission = (resource: string) => {
        if (actor.role === 'super_admin') return;
        if (
          actor.scoped ||
          !actor.permissions.includes(resource + '.read') ||
          !actor.permissions.includes(resource + '.delete')
        )
          throw new AppError('FORBIDDEN', 'Deletion is not granted to your Admin account', 403);
      };
      if (module === 'admins' && actor.role !== 'super_admin')
        throw new AppError('FORBIDDEN', 'Super Admin required', 403);
      requirePermission(permission[module]);
      if (['users', 'drivers', 'admins', 'partners'].includes(module)) {
        let userId = id;
        if (module === 'drivers' || module === 'partners') {
          const table = module === 'drivers' ? 'driver_profiles' : 'partners';
          const lookup = await client.query(`SELECT user_id FROM ${table} WHERE id=$1`, [id]);
          if (!lookup.rowCount) throw new AppError('NOT_FOUND', 'Record not found', 404);
          userId = lookup.rows[0].user_id;
        }
        const result = await client.query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE', [
          userId,
        ]);
        const target = result.rows[0];
        if (!target) throw new AppError('NOT_FOUND', 'Record not found', 404);
        if (module === 'drivers' || module === 'partners') {
          const table = module === 'drivers' ? 'driver_profiles' : 'partners';
          const selected = await client.query(
            `SELECT user_id FROM ${table} WHERE id=$1 FOR UPDATE`,
            [id],
          );
          if (!selected.rowCount || selected.rows[0].user_id !== userId) throw conflict();
        }
        if (userId === actorId || target.role === 'super_admin')
          throw new AppError(
            'PROTECTED_ACCOUNT',
            'Your own account and Super Admin accounts cannot be deleted',
            403,
          );
        if (target.role === 'admin' && module !== 'admins')
          throw new AppError(
            'FORBIDDEN',
            'Use Super Admin account governance for this account',
            403,
          );
        if (module === 'admins' && target.role !== 'admin')
          throw new AppError('FORBIDDEN', 'Only Admin accounts can be deleted here', 403);
        if (module === 'drivers' && !['driver', 'driver_fleet_owner'].includes(target.role))
          throw new AppError('NOT_FOUND', 'Driver not found', 404);
        if (module === 'partners' && !['fleet_owner', 'driver_fleet_owner'].includes(target.role))
          throw new AppError('NOT_FOUND', 'Provider account not found', 404);
        if (['driver', 'driver_fleet_owner'].includes(target.role)) requirePermission('drivers');
        if (['fleet_owner', 'driver_fleet_owner'].includes(target.role))
          requirePermission('partners');
        await this.deleteProfile(client, 'driver_profiles', userId);
        await this.deleteProfile(client, 'partners', userId);
        // Preserve audit records under the acting administrator, including the
        // durable token revocations belonging to previously deleted subjects.
        await client.query('UPDATE user_history SET user_id=$2 WHERE user_id=$1', [
          userId,
          actorId,
        ]);
        for (const table of [
          'refresh_tokens',
          'login_challenges',
          'user_credentials',
          'admin_credentials',
          'password_reset_challenges',
          'user_devices',
          'user_addresses',
          'user_preferences',
          'auth_external_identities',
          'admin_user_roles',
          'admin_scope_assignments',
        ])
          await client.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
        await client.query(
          `DELETE FROM admin_roles r WHERE lower(r.name)=lower($1) AND NOT EXISTS(SELECT 1 FROM admin_user_roles ur WHERE ur.role_id=r.id)`,
          [`managed-admin:${userId}`],
        );
        await this.assertUnreferenced(client, 'users', userId);
        await client.query('DELETE FROM users WHERE id=$1', [userId]);
        deletedSubjectId = userId;
      } else {
        const table = module === 'vehicle-types' ? 'vehicle_types' : module;
        const found = await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
        const row = found.rows[0];
        if (!row) throw new AppError('NOT_FOUND', 'Record not found', 404);
        if (module === 'coupons' && Number(row.usage_count) > 0) throw conflict();
        if (module === 'vehicles') await this.clearUnreviewedRequest(client, 'vehicle', id);
        if (module === 'vehicle-types') {
          // Category codes are also persisted in records without foreign keys.
          const columns = await client.query<{ table: string; column: string }>(
            `SELECT table_name AS table,column_name AS column FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('vehicles','driver_profiles','rides','rentals','logistics_orders') AND column_name IN ('category','vehicle_type','vehicle_category','vehicle_type_code')`,
          );
          for (const c of columns.rows)
            if (
              (
                await client.query(
                  `SELECT 1 FROM ${quote(c.table)} WHERE ${quote(c.column)}::text=$1 LIMIT 1`,
                  [row.code],
                )
              ).rowCount
            )
              throw conflict();
        }
        await this.assertUnreferenced(client, table, id);
        await client.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
      }
      await client.query(
        `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'ADMIN_RECORD_DELETED','ADMIN_RECORD',$2,$3::jsonb)`,
        [
          actorId,
          id,
          JSON.stringify({ module, ...(deletedSubjectId ? { deletedSubjectId } : {}) }),
        ],
      );
      if (deletedSubjectId) revokeDeletedSubject(deletedSubjectId);
      await client.query('COMMIT');
      return { id, deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if (['23503', '40P01', '40001'].includes((error as { code?: string }).code || ''))
        throw conflict();
      throw error;
    } finally {
      client.release();
    }
  }
}
