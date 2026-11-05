import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error.js';
import { AdminManagementService } from './admin-management.service.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { rideEvents } from '../../rides/events/ride.events.js';
import { revokeDeletedSubject } from '../../auth/services/deleted-subjects.js';
import {
  onboardingProfile,
  onboardingJoinsSql,
} from '../../providers/repositories/driver-onboarding-review.js';

export const deletionModuleSchema = z.enum([
  'users',
  'drivers',
  'admins',
  'partners',
  'vehicles',
  'vehicle-types',
  'coupons',
  'support',
  'notifications',
  'approvals',
  'fleet-applications',
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
  support: 'support',
  notifications: 'notifications',
  approvals: 'approvals',
  'fleet-applications': 'approvals',
} as const;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const dependencyReason = (table: string) => {
  if (/document/.test(table))
    return 'protected documents: retain these records and use account deactivation, or an authorized retention workflow';
  if (/wallet|payout|payment|bank|coupon_redemption/.test(table))
    return 'financial records: settle outstanding obligations, retain required financial history and use account deactivation';
  if (table === 'vehicles')
    return 'owned or assigned vehicles: resolve vehicle ownership/assignments through the existing vehicle workflow before retrying';
  if (/approval|application/.test(table))
    return 'approval/application history: retain reviewed or submitted records and use account deactivation';
  if (/partner_drivers|assignment/.test(table))
    return 'fleet/vehicle associations: resolve active associations through the existing fleet workflow; retained association history must be preserved';
  return `${table.replaceAll('_', ' ')}: retained operational records cannot be removed here; use account deactivation or the authorized retention workflow`;
};
const conflict = (dependencies?: string[]) =>
  new AppError(
    'DELETE_DEPENDENCY_CONFLICT',
    dependencies?.length
      ? `Permanent deletion blocked by ${[...new Set(dependencies)].map(dependencyReason).join('; ')}. No records were deleted.`
      : 'A related record changed during deletion. Refresh and retry; retained documents and business history cannot be deleted here. No records were deleted.',
    409,
  );

export class RecordDeletionService {
  private async cancelLinkedWork(
    client: PoolClient,
    userId: string | null,
    vehicleId: string | null,
    reason: string,
  ) {
    const rides = await client.query<{ id: string; assigned_driver_id: string | null }>(
      `UPDATE rides r SET status='cancelled',cancellation_reason=$3,cancelled_at=NOW(),
       dispatch_driver_id=NULL,dispatch_expires_at=NULL
       WHERE r.status::text IN ('requested','searching','driver_assigned','driver_arriving','driver_arrived','in_progress')
       AND (r.customer_id=$1 OR r.assigned_driver_id IN(SELECT id FROM driver_profiles WHERE user_id=$1)
         OR r.assigned_vehicle_id=$2 OR r.assigned_vehicle_id IN(SELECT id FROM vehicles WHERE owner_id=$1))
       RETURNING id,assigned_driver_id`,
      [userId, vehicleId, reason],
    );
    for (const ride of rides.rows) {
      await client.query(
        "UPDATE ride_dispatch_attempts SET status='timed_out',responded_at=NOW() WHERE ride_id=$1 AND status='offered'",
        [ride.id],
      );
      if (ride.assigned_driver_id)
        await new PostgresDriverRepository(this.database).releaseBusy(
          ride.assigned_driver_id,
          client,
        );
    }
    await client.query(
      `UPDATE rentals SET status='CANCELLED',cancellation_reason=$3,cancelled_at=NOW()
      WHERE status::text IN ('PENDING','CONFIRMED','ACTIVE') AND (user_id=$1 OR vehicle_id=$2 OR vehicle_id IN(SELECT id FROM vehicles WHERE owner_id=$1))`,
      [userId, vehicleId, reason],
    );
    if (userId)
      await client.query(
        `UPDATE logistics_orders SET status='CANCELLED',cancellation_reason=$2,cancelled_at=NOW()
      WHERE user_id=$1 AND status::text NOT IN ('DELIVERED','CANCELLED','FAILED')`,
        [userId, reason],
      );
    return rides.rows.map((row) => row.id);
  }

  private async eraseIdentity(client: PoolClient, userId: string) {
    // Retained rows are non-authenticating reference anchors, never active accounts.
    // Do not cascade through financial, operational or legally retained evidence.
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
    for (const table of ['users', 'driver_profiles', 'partners'] as const) {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND is_nullable='YES' AND column_name ~ '(first_name|last_name|email|phone|address|birth|gender|photo|emergency_contact|business_description|contact_person|^owner_name$|^dob$|^city$|^state$|^pin_code$|^gst_number$)'`,
        [table],
      );
      if (columns.rowCount)
        await client.query(
          `UPDATE ${table} SET ${columns.rows.map((row) => quote(row.column_name) + '=NULL').join(',')} WHERE ${table === 'users' ? 'id' : 'user_id'}=$1`,
          [userId],
        );
    }
    await client.query(
      "UPDATE users SET first_name='Deleted',last_name='Account',email=NULL,phone=NULL,status='suspended',deleted_at=COALESCE(deleted_at,NOW()),updated_at=NOW() WHERE id=$1",
      [userId],
    );
    await client.query(
      "UPDATE driver_profiles SET license_number='DELETED_'||id::text,availability_status='unavailable',updated_at=NOW() WHERE user_id=$1",
      [userId],
    );
    await client.query(
      "UPDATE partners SET business_name='Deleted account',availability_status='offline',updated_at=NOW() WHERE user_id=$1",
      [userId],
    );
    await client.query('UPDATE vehicles SET is_active=FALSE WHERE owner_id=$1', [userId]);
    await client.query(
      `UPDATE provider_approval_requests SET admin_deleted_at=COALESCE(admin_deleted_at,NOW()) WHERE requester_id=$1 OR (target_type='driver_profile' AND target_id IN(SELECT id FROM driver_profiles WHERE user_id=$1)) OR (target_type='partner' AND target_id IN(SELECT id FROM partners WHERE user_id=$1))`,
      [userId],
    );
    await client.query(
      `UPDATE driver_applications SET admin_deleted_at=COALESCE(admin_deleted_at,NOW()) WHERE driver_profile_id IN(SELECT id FROM driver_profiles WHERE user_id=$1) OR partner_id IN(SELECT id FROM partners WHERE user_id=$1)`,
      [userId],
    );
  }
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
    const blocked: string[] = [];
    for (const ref of refs.rows) {
      // Issuance history survives through account_id. This FK only tracks the live
      // account and PostgreSQL clears it on deletion; it is not operational history.
      if (
        table === 'users' &&
        ref.table === 'provider_identity_accounts' &&
        ref.column === 'user_id'
      )
        continue;
      const result = await client.query(
        `SELECT 1 FROM ${quote(ref.schema)}.${quote(ref.table)} WHERE ${quote(ref.column)}=$1 LIMIT 1`,
        [id],
      );
      if (result.rowCount) blocked.push(ref.table);
    }
    if (blocked.length) throw conflict(blocked);
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
      throw conflict(['provider_approval_requests']);
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
    if (
      Object.entries(row).some(
        ([key, value]) => /(?:document|photo)_(?:key|url)$/.test(key) && value,
      )
    )
      throw conflict([table === 'partners' ? 'partner_documents' : 'driver_documents']);
    await this.clearUnreviewedRequest(
      client,
      table === 'partners' ? 'partner' : 'driver_profile',
      row.id,
    );
    await this.assertUnreferenced(client, table, row.id);
    await client.query(`DELETE FROM ${table} WHERE id=$1`, [row.id]);
  }

  async remove(
    actorId: string,
    actorRole: string,
    module: Module,
    id: string,
    reason = 'Administrative deletion',
  ) {
    z.string().uuid().parse(id);
    reason = z.string().trim().min(5).max(500).parse(reason);
    const client = await this.database.connect();
    let deletedSubjectId: string | undefined;
    let affectedIds: string[] | undefined;
    let identityErased = false;
    let cancelledRideIds: string[] = [];
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
      const retained = ['support', 'notifications', 'approvals', 'fleet-applications'].includes(
        module,
      );
      if (module === 'approvals') {
        const profile = await onboardingProfile(client, id);
        if (profile?.id)
          await client.query('SELECT id FROM driver_profiles WHERE id=$1 FOR UPDATE', [profile.id]);
        const requests = await client.query(
          `SELECT r.id,r.status,r.target_type,r.admin_deleted_at FROM provider_approval_requests r ${onboardingJoinsSql}
           WHERE ($2::uuid IS NULL AND r.id=$1) OR ($2::uuid IS NOT NULL AND dp.id=$2) ORDER BY r.id FOR UPDATE OF r`,
          [id, profile?.id ?? null],
        );
        if (!requests.rows.some((row) => row.id === id && !row.admin_deleted_at))
          throw new AppError('NOT_FOUND', 'Request not found', 404);
        if (
          requests.rows.some(
            (row) => row.target_type === 'bank_account' || row.status === 'PENDING',
          )
        )
          throw new AppError(
            'DELETE_DEPENDENCY_CONFLICT',
            'Pending approvals and bank verification records cannot be deleted. Complete the review first; decision history is retained.',
            409,
          );
        affectedIds = requests.rows.filter((row) => !row.admin_deleted_at).map((row) => row.id);
        await client.query(
          'UPDATE provider_approval_requests SET admin_deleted_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND admin_deleted_at IS NULL',
          [affectedIds],
        );
      } else if (module === 'fleet-applications') {
        const found = await client.query(
          'SELECT status FROM driver_applications WHERE id=$1 AND admin_deleted_at IS NULL FOR UPDATE',
          [id],
        );
        if (!found.rowCount) throw new AppError('NOT_FOUND', 'Application not found', 404);
        if (!['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(found.rows[0].status))
          throw new AppError(
            'DELETE_DEPENDENCY_CONFLICT',
            'Complete the fleet application review before deleting it from active administration. Membership and application history will be retained.',
            409,
          );
        await client.query(
          'UPDATE driver_applications SET admin_deleted_at=clock_timestamp() WHERE id=$1',
          [id],
        );
      } else if (retained) {
        const table = module === 'support' ? 'support_tickets' : 'notifications';
        const found = await client.query(
          `SELECT * FROM ${table} WHERE id=$1 AND admin_deleted_at IS NULL FOR UPDATE`,
          [id],
        );
        const row = found.rows[0];
        if (!row) throw new AppError('NOT_FOUND', 'Record not found', 404);
        if (
          module === 'vehicles' &&
          (
            await client.query(
              "SELECT 1 FROM user_history WHERE event_type='ADMIN_RECORD_DELETED' AND entity_id=$1 AND metadata->>'module'='vehicles'",
              [id],
            )
          ).rowCount
        )
          throw new AppError('NOT_FOUND', 'Record not found', 404);
        if (module === 'support' && row.status !== 'CLOSED')
          throw new AppError(
            'DELETE_DEPENDENCY_CONFLICT',
            'Close the support ticket before deleting it from active administration. Its history will be retained.',
            409,
          );
        if (
          module === 'notifications' &&
          (row.processing_status !== 'PROCESSED' || row.delivery_status !== 'DELIVERED')
        )
          throw new AppError(
            'DELETE_DEPENDENCY_CONFLICT',
            'Notification delivery is incomplete or may be retried. Only fully delivered notifications can be removed from active administration.',
            409,
          );
        await client.query(`UPDATE ${table} SET admin_deleted_at=clock_timestamp() WHERE id=$1`, [
          id,
        ]);
      } else if (['users', 'drivers', 'admins', 'partners'].includes(module)) {
        let userId = id;
        if (module === 'drivers' || module === 'partners') {
          const table = module === 'drivers' ? 'driver_profiles' : 'partners';
          const lookup = await client.query(`SELECT user_id FROM ${table} WHERE id=$1`, [id]);
          if (!lookup.rowCount) throw new AppError('NOT_FOUND', 'Record not found', 404);
          userId = lookup.rows[0].user_id;
        }
        const result = await client.query(
          'SELECT id,role FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
          [userId],
        );
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
        cancelledRideIds = await this.cancelLinkedWork(client, userId, null, reason);
        await client.query('SAVEPOINT eligible_account_removal');
        try {
          await this.deleteProfile(client, 'driver_profiles', userId);
          await this.deleteProfile(client, 'partners', userId);
          // Merely opening the wallet API creates a zero-balance shell. It is not
          // financial history, but even a settled wallet with entries must remain.
          await client.query('SELECT user_id FROM provider_wallets WHERE user_id=$1 FOR UPDATE', [
            userId,
          ]);
          await client.query(
            `DELETE FROM provider_wallets w WHERE w.user_id=$1 AND w.balance_paise=0
           AND NOT EXISTS(SELECT 1 FROM provider_wallet_entries e WHERE e.user_id=w.user_id)
           AND NOT EXISTS(SELECT 1 FROM provider_payouts p WHERE p.user_id=w.user_id)`,
            [userId],
          );
          // Preserve audit records under the acting administrator, including the
          // durable token revocations belonging to previously deleted subjects.
          await client.query(
            `UPDATE user_history SET user_id=$2,metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('originalSubjectId',COALESCE(metadata->>'originalSubjectId',$1::text)) WHERE user_id=$1`,
            [userId, actorId],
          );
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
        } catch (error) {
          if (
            !(error instanceof AppError && error.code === 'DELETE_DEPENDENCY_CONFLICT') &&
            (error as { code?: string }).code !== '23503'
          )
            throw error;
          await client.query('ROLLBACK TO SAVEPOINT eligible_account_removal');
          // Only keep a profile when it has its own protected references.
          for (const table of ['driver_profiles', 'partners'] as const) {
            await client.query('SAVEPOINT eligible_profile_removal');
            try {
              await this.deleteProfile(client, table, userId);
            } catch (profileError) {
              if (
                !(
                  profileError instanceof AppError &&
                  profileError.code === 'DELETE_DEPENDENCY_CONFLICT'
                ) &&
                (profileError as { code?: string }).code !== '23503'
              )
                throw profileError;
              await client.query('ROLLBACK TO SAVEPOINT eligible_profile_removal');
            }
            await client.query('RELEASE SAVEPOINT eligible_profile_removal');
          }
          await this.eraseIdentity(client, userId);
          identityErased = true;
        }
        await client.query('RELEASE SAVEPOINT eligible_account_removal');
        deletedSubjectId = userId;
      } else {
        const table = module === 'vehicle-types' ? 'vehicle_types' : module;
        const found = await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
        const row = found.rows[0];
        if (!row) throw new AppError('NOT_FOUND', 'Record not found', 404);
        if (
          module === 'vehicles' &&
          (
            await client.query(
              "SELECT 1 FROM user_history WHERE event_type='ADMIN_RECORD_DELETED' AND entity_id=$1 AND metadata->>'module'='vehicles'",
              [id],
            )
          ).rowCount
        )
          throw new AppError('NOT_FOUND', 'Record not found', 404);
        if (module === 'coupons' && Number(row.usage_count) > 0)
          throw conflict(['coupon_redemptions']);
        if (module === 'vehicles') await this.clearUnreviewedRequest(client, 'vehicle', id);
        if (module === 'vehicle-types') {
          const catalog = await client.query(
            'SELECT 1 FROM fleet_registration_vehicle_types WHERE sector=$1 AND code=$2',
            [row.sector, row.code],
          );
          if (catalog.rowCount)
            throw conflict(['vehicle_catalog: deactivate this category instead']);
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
              throw conflict([c.table]);
        }
        if (module === 'vehicles') {
          cancelledRideIds = await this.cancelLinkedWork(client, null, id, reason);
          await client.query('UPDATE vehicles SET is_active=FALSE WHERE id=$1', [id]);
          await client.query(
            "UPDATE provider_approval_requests SET admin_deleted_at=COALESCE(admin_deleted_at,NOW()) WHERE target_type='vehicle' AND target_id=$1",
            [id],
          );
        } else await this.assertUnreferenced(client, table, id);
        if (module !== 'vehicles') await client.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
      }
      await client.query(
        `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'ADMIN_RECORD_DELETED','ADMIN_RECORD',$2,$3::jsonb)`,
        [
          actorId,
          id,
          JSON.stringify({
            module,
            reason,
            cancelledRideIds,
            mode: retained ? 'retained' : 'permanent',
            ...(identityErased ? { identityErased: true, protectedHistoryRetained: true } : {}),
            ...(affectedIds ? { affectedIds } : {}),
            ...(deletedSubjectId ? { deletedSubjectId } : {}),
          }),
        ],
      );
      await client.query('COMMIT');
      if (deletedSubjectId) revokeDeletedSubject(deletedSubjectId);
      for (const rideId of cancelledRideIds) rideEvents.emit('ride:cancelled', rideId);
      if (identityErased)
        return {
          id,
          deleted: true,
          mode: 'permanent',
          message:
            'Account identity and login access permanently removed; protected history retained.',
        };
      return retained
        ? {
            id,
            deleted: true,
            mode: 'retained',
            message: 'Record removed from active administration; history retained.',
          }
        : { id, deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23503') {
        const table = (error as { table?: string }).table;
        throw conflict(table ? [table] : undefined);
      }
      if (['40P01', '40001'].includes((error as { code?: string }).code || '')) throw conflict();
      throw error;
    } finally {
      client.release();
    }
  }
}
