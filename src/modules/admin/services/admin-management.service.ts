import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error.js';
import { hashPassword } from '../../auth/utils/password.js';
import { emailSchema } from '../../auth/schemas/auth.schemas.js';
import { permissionCatalog } from './permission-policy.js';

const permissionsSchema = z
  .array(z.enum(permissionCatalog))
  .max(permissionCatalog.length)
  .refine((v) => new Set(v).size === v.length, 'Duplicate permissions');
export const createAdminSchema = z
  .object({
    email: emailSchema.transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(128),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    permissions: permissionsSchema.default([]),
  })
  .strict();
export const updatePermissionsSchema = z
  .object({ permissions: permissionsSchema, expectedUpdatedAt: z.string().min(1).max(100) })
  .strict();

export class AdminManagementService {
  constructor(private database: Pool) {}
  async setStatus(actorId: string, id: string, raw: unknown) {
    const input = z
      .object({
        status: z.enum(['active', 'suspended']),
        expectedUpdatedAt: z.string().min(1).max(100),
      })
      .strict()
      .parse(raw);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.superActor(client, actorId);
      const target = await client.query(
        `SELECT role,status,updated_at::text AS "updatedAt" FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      const user = target.rows[0];
      if (!user) throw new AppError('NOT_FOUND', 'Admin not found', 404);
      if (user.role !== 'admin' || id === actorId)
        throw new AppError('FORBIDDEN', 'Only Admin account status can be changed', 403);
      if (user.updatedAt !== input.expectedUpdatedAt)
        throw new AppError(
          'VERSION_CONFLICT',
          'This admin was changed. Reload before saving.',
          409,
        );
      if (!['active', 'suspended'].includes(user.status))
        throw new AppError(
          'INVALID_STATUS',
          'This account requires a separate account review',
          409,
        );
      await client.query('UPDATE users SET status=$2,updated_at=clock_timestamp() WHERE id=$1', [
        id,
        input.status,
      ]);
      if (input.status === 'suspended')
        await client.query(
          'UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1 AND revoked_at IS NULL',
          [id],
        );
      await client.query(
        `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'ADMIN_STATUS_UPDATED','USER',$1,$2::jsonb)`,
        [id, JSON.stringify({ actorId, previousStatus: user.status, status: input.status })],
      );
      await client.query('COMMIT');
      return { id, status: input.status };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async identity(id: string, expectedRole?: string) {
    const result = await this.database.query(
      `SELECT id,first_name AS "firstName",last_name AS "lastName",email,role,status,updated_at::text AS "updatedAt" FROM users WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active' || !['admin', 'super_admin'].includes(user.role))
      throw new AppError('FORBIDDEN', 'Active administrative account required', 403);
    if (expectedRole && user.role !== expectedRole)
      throw new AppError('FORBIDDEN', 'Administrative role changed; sign in again', 403);
    const grants = await this.database.query<{ key: string }>(
      `SELECT DISTINCT p.resource||'.'||p.action AS key FROM admin_user_roles ur JOIN admin_roles r ON r.id=ur.role_id AND r.is_active JOIN admin_role_permissions rp ON rp.role_id=r.id JOIN admin_permissions p ON p.id=rp.permission_id AND p.is_active WHERE ur.user_id=$1 AND ur.revoked_at IS NULL`,
      [id],
    );
    const scoped = await this.database.query(
      `SELECT 1 FROM admin_scope_assignments WHERE user_id=$1 AND revoked_at IS NULL LIMIT 1`,
      [id],
    );
    return {
      ...user,
      permissions:
        user.role === 'super_admin'
          ? [...permissionCatalog]
          : grants.rows
              .map((g) => g.key)
              .filter((k) => (permissionCatalog as readonly string[]).includes(k)),
      scoped: scoped.rowCount !== 0,
    };
  }
  async list(actorId: string, page = 1, adminId?: string) {
    const actor = await this.identity(actorId);
    if (actor.role !== 'super_admin') throw new AppError('FORBIDDEN', 'Super Admin required', 403);
    const count = await this.database.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM users WHERE role='admin' AND deleted_at IS NULL AND ($1::uuid IS NULL OR id=$1)`,
      [adminId || null],
    );
    const result = await this.database.query(
      `SELECT id,first_name AS "firstName",last_name AS "lastName",email,status,updated_at::text AS "updatedAt" FROM users WHERE role='admin' AND deleted_at IS NULL AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at DESC,id LIMIT 25 OFFSET $2`,
      [adminId || null, (page - 1) * 25],
    );
    const users = await Promise.all(
      result.rows.map(async (row) => {
        const grants = await this.database.query<{ key: string }>(
          `SELECT DISTINCT p.resource||'.'||p.action AS key FROM admin_user_roles ur JOIN admin_roles r ON r.id=ur.role_id AND r.is_active JOIN admin_role_permissions rp ON rp.role_id=r.id JOIN admin_permissions p ON p.id=rp.permission_id AND p.is_active WHERE ur.user_id=$1 AND ur.revoked_at IS NULL`,
          [row.id],
        );
        return { ...row, permissions: grants.rows.map((g) => g.key) };
      }),
    );
    return {
      items: users,
      catalog: permissionCatalog,
      page,
      pageSize: 25,
      total: count.rows[0]!.total,
    };
  }
  private async superActor(client: PoolClient, actorId: string) {
    const result = await client.query(
      `SELECT id FROM users WHERE id=$1 AND role='super_admin' AND status='active' AND deleted_at IS NULL FOR SHARE`,
      [actorId],
    );
    if (!result.rowCount) throw new AppError('FORBIDDEN', 'Super Admin required', 403);
  }
  private async replace(
    client: PoolClient,
    actorId: string,
    id: string,
    permissions: readonly string[],
  ) {
    // Preserve historical assignments. Replace the effective set only on the explicitly selected admin.
    await client.query(
      'UPDATE admin_user_roles SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',
      [id],
    );
    const role = await client.query<{ id: string }>(
      `INSERT INTO admin_roles(name,description,created_by) VALUES($1,'Individually managed administrative grants',$2) ON CONFLICT(lower(name)) DO UPDATE SET is_active=TRUE RETURNING id`,
      [`managed-admin:${id}`, actorId],
    );
    const roleId = role.rows[0]!.id;
    const shared = await client.query(
      'SELECT 1 FROM admin_user_roles WHERE role_id=$1 AND user_id<>$2 AND revoked_at IS NULL LIMIT 1',
      [roleId, id],
    );
    if (shared.rowCount)
      throw new AppError(
        'ROLE_SHARED',
        'This managed role is shared with another account; review assignments before changing it',
        409,
      );
    await client.query('DELETE FROM admin_role_permissions WHERE role_id=$1', [roleId]);
    for (const key of permissions) {
      const [resource, action] = key.split('.');
      const p = await client.query<{ id: string }>(
        `INSERT INTO admin_permissions(resource,action,description) VALUES($1,$2,$3) ON CONFLICT(resource,action) DO UPDATE SET is_active=TRUE RETURNING id`,
        [resource, action, key],
      );
      await client.query(
        'INSERT INTO admin_role_permissions(role_id,permission_id) VALUES($1,$2)',
        [roleId, p.rows[0]!.id],
      );
    }
    await client.query(
      `INSERT INTO admin_user_roles(user_id,role_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT(user_id,role_id) DO UPDATE SET revoked_at=NULL,assigned_at=NOW(),assigned_by=EXCLUDED.assigned_by`,
      [id, roleId, actorId],
    );
    await client.query(
      `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'ADMIN_PERMISSIONS_UPDATED','USER',$1,$2::jsonb)`,
      [id, JSON.stringify({ actorId, permissions })],
    );
  }
  async create(actorId: string, raw: unknown) {
    const input = createAdminSchema.parse(raw);
    const hash = await hashPassword(input.password);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.superActor(client, actorId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `admin-provision:${input.email}`,
      ]);
      const duplicate = await client.query('SELECT id FROM users WHERE lower(btrim(email))=$1', [
        input.email,
      ]);
      if (duplicate.rowCount)
        throw new AppError('ACCOUNT_EXISTS', 'An account with this email already exists', 409);
      const created = await client.query<{ id: string }>(
        `INSERT INTO users(first_name,last_name,email,phone,role,status) VALUES($1,$2,$3,NULL,'admin','active') RETURNING id`,
        [input.firstName, input.lastName, input.email],
      );
      const id = created.rows[0]!.id;
      await client.query('INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)', [
        id,
        hash,
      ]);
      await this.replace(client, actorId, id, input.permissions);
      await client.query('COMMIT');
      return { id, role: 'admin', email: input.email, permissions: input.permissions };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505')
        throw new AppError('ACCOUNT_EXISTS', 'An account with this email already exists', 409);
      throw error;
    } finally {
      client.release();
    }
  }
  async update(actorId: string, id: string, raw: unknown) {
    const input = updatePermissionsSchema.parse(raw);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.superActor(client, actorId);
      const target = await client.query(
        `SELECT role,updated_at::text AS updated_at FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      if (!target.rowCount) throw new AppError('NOT_FOUND', 'Admin not found', 404);
      if (target.rows[0].role !== 'admin' || id === actorId)
        throw new AppError('FORBIDDEN', 'Only Admin permissions can be changed', 403);
      if (target.rows[0].updated_at !== input.expectedUpdatedAt)
        throw new AppError(
          'VERSION_CONFLICT',
          'This admin was changed. Reload before saving.',
          409,
        );
      await this.replace(client, actorId, id, input.permissions);
      await client.query('UPDATE users SET updated_at=clock_timestamp() WHERE id=$1', [id]);
      await client.query('COMMIT');
      return { id, permissions: input.permissions };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
