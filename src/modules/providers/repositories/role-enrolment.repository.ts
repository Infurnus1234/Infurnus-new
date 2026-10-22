import { FleetFinancialReportRepository } from './fleet-financial-report.repository.js';
import type { Pool, PoolClient } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';

const roles = ['driver', 'driver_fleet_owner', 'fleet_owner'];
export class RoleEnrolmentRepository {
  constructor(private readonly pool: Pool) {}
  private async actor(c: PoolClient, id: string, role: string) {
    if (
      !roles.includes(role) ||
      !(
        await c.query(
          "SELECT id FROM users WHERE id=$1 AND role::text=$2 AND status='active' AND deleted_at IS NULL FOR SHARE",
          [id, role],
        )
      ).rowCount
    )
      throw new AppError('FORBIDDEN', 'Active provider account required', 403);
  }
  private async transaction<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async state(
    id: string,
    role: string,
    input?: { step?: string; skipped?: boolean; complete?: boolean; deferSetup?: boolean },
  ) {
    return this.transaction(async (c) => {
      await this.actor(c, id, role);
      await c.query(
        'INSERT INTO provider_onboarding(user_id,role_flow_active) VALUES($1,TRUE) ON CONFLICT(user_id) DO UPDATE SET role_flow_active=TRUE WHERE NOT provider_onboarding.role_flow_active',
        [id],
      );
      const s = (
        await c.query('SELECT * FROM provider_onboarding WHERE user_id=$1 FOR UPDATE', [id])
      ).rows[0];
      const steps =
        role === 'driver'
          ? ['vehicle_assignment', 'profile_photo']
          : role === 'fleet_owner'
            ? ['business', 'driver', 'vehicle']
            : ['licence', 'profile_photo', 'details'];
      if (input?.step) {
        if (!steps.includes(input.step))
          throw new AppError('INVALID_STEP', 'Choose a supported onboarding step', 400);
        if (s.role_selection_pending)
          throw new AppError('ROLE_REQUIRED', 'Choose your account role first', 409);
        // A skipped step is progress, never proof of a document, approval or entity.
        if (!input.skipped) {
          const query: Record<string, string> = {
            vehicle_assignment:
              'SELECT v.id FROM vehicles v JOIN driver_profiles dp ON dp.id=v.driver_profile_id AND dp.active_vehicle_id=v.id WHERE dp.user_id=$1',
            business: 'SELECT id FROM partners WHERE user_id=$1',
            driver: `SELECT i.id FROM driver_onboarding_invitations i JOIN partners p ON p.id=i.partner_id WHERE p.user_id=$1 UNION ALL SELECT m.driver_user_id FROM fleet_managed_driver_accounts m JOIN partners p ON p.id=m.partner_id WHERE p.user_id=$1 AND m.status='ACTIVE'`,
            vehicle: 'SELECT id FROM vehicles WHERE owner_id=$1',
            licence:
              "SELECT d.id FROM driver_documents d JOIN driver_profiles dp ON dp.id=d.driver_profile_id WHERE dp.user_id=$1 AND d.document_type='driver_license' AND d.verification_status::text NOT IN ('rejected','expired','changes_requested')",
            profile_photo:
              "SELECT user_id FROM provider_onboarding WHERE user_id=$1 AND account_photo IS NOT NULL UNION ALL SELECT dp.user_id FROM driver_documents d JOIN driver_profiles dp ON dp.id=d.driver_profile_id WHERE dp.user_id=$1 AND d.document_type='profile_photo' AND d.verification_status::text NOT IN ('rejected','expired','changes_requested')",
            details:
              'SELECT id FROM users WHERE id=$1 AND length(trim(first_name))>0 AND length(trim(last_name))>0',
          };
          if (!(await c.query(query[input.step]!, [id])).rowCount)
            throw new AppError(
              'STEP_NOT_SAVED',
              'Save this information before continuing, or skip it',
              409,
            );
        }
        s.flow_steps[input.step] = input.skipped ? 'skipped' : 'completed';
        await c.query(
          'UPDATE provider_onboarding SET flow_steps=$2::jsonb,updated_at=NOW() WHERE user_id=$1',
          [id, JSON.stringify(s.flow_steps)],
        );
      }
      const ready =
        !s.role_selection_pending &&
        steps
          .filter((x) => x !== 'code')
          .every((x) => ['skipped', 'completed'].includes(s.flow_steps[x]));
      if (input?.deferSetup) {
        if (s.role_selection_pending)
          throw new AppError('ROLE_REQUIRED', 'Choose your account role first', 409);
        await c.query(
          `UPDATE provider_onboarding SET dashboard_deferred_at=COALESCE(dashboard_deferred_at,NOW()),flow_steps=CASE WHEN $2::boolean AND NOT EXISTS(SELECT 1 FROM vehicles v JOIN driver_profiles dp ON dp.id=v.driver_profile_id AND dp.active_vehicle_id=v.id WHERE dp.user_id=$1) THEN jsonb_set(flow_steps,'{vehicle_assignment}',to_jsonb('skipped'::text)) ELSE flow_steps END,updated_at=NOW() WHERE user_id=$1`,
          [id, role === 'driver'],
        );
        s.dashboard_deferred_at = new Date();
        s.flow_steps = (
          await c.query('SELECT flow_steps FROM provider_onboarding WHERE user_id=$1', [id])
        ).rows[0].flow_steps;
      }
      if (input?.complete) {
        if (!ready)
          throw new AppError(
            'ONBOARDING_INCOMPLETE',
            'Complete the remaining onboarding steps',
            403,
          );
        await c.query(
          'UPDATE provider_onboarding SET flow_completed_at=COALESCE(flow_completed_at,NOW()),updated_at=NOW() WHERE user_id=$1',
          [id],
        );
        s.flow_completed_at = s.flow_completed_at ?? new Date();
      }
      return {
        role,
        roleSelectionPending: s.role_selection_pending,
        steps,
        progress: s.flow_steps,
        codeVerified: !!s.driver_code_verified_at,
        completed: !!s.flow_completed_at,
        dashboardAccessible:
          !s.role_selection_pending &&
          (!!s.dashboard_deferred_at || (ready && !!s.flow_completed_at)),
        setupDeferred: !!s.dashboard_deferred_at,
        assignmentStatus: (
          await c.query(
            'SELECT 1 FROM vehicles v JOIN driver_profiles dp ON dp.id=v.driver_profile_id AND dp.active_vehicle_id=v.id WHERE dp.user_id=$1 LIMIT 1',
            [id],
          )
        ).rowCount
          ? 'assigned'
          : 'unassigned',
      };
    });
  }
  async photo(id: string, role: string) {
    return this.transaction(async (c) => {
      await this.actor(c, id, role);
      return (
        (await c.query('SELECT account_photo FROM provider_onboarding WHERE user_id=$1', [id]))
          .rows[0]?.account_photo ?? null
      );
    });
  }
  async savePhoto(id: string, role: string, photo: object) {
    return this.transaction(async (c) => {
      await this.actor(c, id, role);
      const saved = await c.query(
        'UPDATE provider_onboarding SET account_photo=$2::jsonb,updated_at=NOW() WHERE user_id=$1 AND NOT role_selection_pending RETURNING user_id',
        [id, JSON.stringify(photo)],
      );
      if (!saved.rowCount)
        throw new AppError('ONBOARDING_INCOMPLETE', 'Choose your account role first', 403);
      return { saved: true };
    });
  }
  async selectRole(id: string, currentRole: string, role: string) {
    return this.transaction(async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
      await this.actor(c, id, currentRole);
      const s = (
        await c.query('SELECT * FROM provider_onboarding WHERE user_id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (!roles.includes(role) || !s?.role_selection_pending)
        throw new AppError(
          'ROLE_LOCKED',
          'Existing account roles cannot be changed during signup',
          409,
        );
      const conflict = await c.query(
        `SELECT other.id FROM users mine JOIN users other ON other.id<>mine.id
        AND other.role::text=$2 AND other.deleted_at IS NULL
        AND ((mine.email IS NOT NULL AND lower(btrim(other.email))=lower(btrim(mine.email)))
          OR (mine.phone IS NOT NULL AND ltrim(btrim(other.phone),'+')=ltrim(btrim(mine.phone),'+')))
        WHERE mine.id=$1`,
        [id, role],
      );
      if (conflict.rowCount)
        throw new AppError(
          'ACCOUNT_ROLE_EXISTS',
          'An account already exists for this identity and role. Sign in to that account.',
          409,
        );
      await c.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [id]);
      await c.query('UPDATE users SET role=$2 WHERE id=$1', [id, role]);
      await c.query(
        'UPDATE provider_onboarding SET role_selection_pending=FALSE,updated_at=NOW() WHERE user_id=$1',
        [id],
      );
      return role;
    });
  }
  async fleetReport(id: string, role: string, month: string) {
    return new FleetFinancialReportRepository(this.pool).report(id, role, month);
  }
  async invitations(id: string, role: string) {
    return this.transaction(async (c) => {
      await this.actor(c, id, role);
      if (!['fleet_owner', 'driver_fleet_owner'].includes(role))
        throw new AppError('FORBIDDEN', 'Fleet Owner required', 403);
      return (
        await c.query(
          'SELECT i.id,i.driver_user_id AS "driverUserId",u.first_name AS "firstName",u.last_name AS "lastName",i.status,i.expires_at AS "expiresAt" FROM driver_onboarding_invitations i JOIN partners p ON p.id=i.partner_id JOIN users u ON u.id=i.driver_user_id WHERE p.user_id=$1 ORDER BY i.created_at DESC LIMIT 100',
          [id],
        )
      ).rows;
    });
  }
  async addDriver(owner: string, role: string, email: string, driverUserId?: string) {
    return this.transaction(async (c) => {
      await this.actor(c, owner, role);
      if (!['fleet_owner', 'driver_fleet_owner'].includes(role))
        throw new AppError('FORBIDDEN', 'Fleet Owner required', 403);
      const p = (
        await c.query(
          "SELECT id FROM partners WHERE user_id=$1 AND approval_status='approved' FOR SHARE",
          [owner],
        )
      ).rows[0];
      if (!p)
        throw new AppError(
          'BUSINESS_APPROVAL_REQUIRED',
          'An approved business is required to invite Drivers',
          403,
        );
      const matches = (
        await c.query(
          "SELECT id,role FROM users WHERE LOWER(email)=LOWER($1) AND role IN ('driver','driver_fleet_owner') AND status='active' AND deleted_at IS NULL AND ($2::uuid IS NULL OR id=$2) FOR SHARE",
          [email, driverUserId ?? null],
        )
      ).rows;
      if (matches.length > 1)
        throw new AppError(
          'DRIVER_ACCOUNT_REQUIRED',
          'Specify driverUserId for the intended Driver account',
          409,
        );
      const d = matches[0];
      if (!d)
        throw new AppError(
          'DRIVER_NOT_FOUND',
          'An active registered Driver account is required',
          404,
        );
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'driver-invite:' + p.id + ':' + d.id,
      ]);
      await c.query(
        "UPDATE driver_onboarding_invitations SET status='REVOKED' WHERE partner_id=$1 AND driver_user_id=$2 AND status='ACTIVE'",
        [p.id, d.id],
      );
      const code = d.role === 'driver' ? randomBytes(6).toString('hex').toUpperCase() : null;
      const saved = (
        await c.query(
          'INSERT INTO driver_onboarding_invitations(partner_id,driver_user_id,code_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'48 hours\') RETURNING id,expires_at AS "expiresAt"',
          [p.id, d.id, code ? createHash('sha256').update(code).digest('hex') : null],
        )
      ).rows[0];
      const profile = (
        await c.query(
          "SELECT id FROM driver_profiles WHERE user_id=$1 AND verification_status='approved' AND license_expiry>=CURRENT_DATE",
          [d.id],
        )
      ).rows[0];
      if (profile)
        await c.query(
          `INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id) VALUES($1,$2,$3,'driver_association','driver_profile',$4) ON CONFLICT DO NOTHING`,
          [owner, role, p.id, profile.id],
        );
      return {
        ...saved,
        code,
        driverUserId: d.id,
        status: code ? 'PENDING_DRIVER_VERIFICATION' : 'PENDING_ASSOCIATION',
      };
    });
  }
  async verifyCode(id: string, role: string, code: string) {
    return this.transaction(async (c) => {
      await this.actor(c, id, role);
      if (role !== 'driver')
        throw new AppError('FORBIDDEN', 'Driver-only onboarding code required', 403);
      const invitation = (
        await c.query(
          "SELECT i.* FROM driver_onboarding_invitations i JOIN partners p ON p.id=i.partner_id WHERE i.code_hash=$1 AND i.driver_user_id=$2 AND p.approval_status='approved' AND i.expires_at>NOW() FOR UPDATE OF i",
          [createHash('sha256').update(code.toUpperCase()).digest('hex'), id],
        )
      ).rows[0];
      if (
        !invitation ||
        invitation.status === 'REVOKED' ||
        new Date(invitation.expires_at) <= new Date()
      )
        throw new AppError(
          'INVALID_DRIVER_CODE',
          'Invalid, expired or revoked Driver onboarding code',
          400,
        );
      await c.query(
        "UPDATE driver_onboarding_invitations SET status='CONSUMED',consumed_at=COALESCE(consumed_at,NOW()) WHERE id=$1",
        [invitation.id],
      );
      await c.query(
        'INSERT INTO provider_onboarding(user_id,driver_code_verified_at) VALUES($1,NOW()) ON CONFLICT(user_id) DO UPDATE SET driver_code_verified_at=COALESCE(provider_onboarding.driver_code_verified_at,NOW()),updated_at=NOW()',
        [id],
      );
      return { verified: true };
    });
  }
}
