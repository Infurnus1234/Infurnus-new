import { managedDriverContactsSchema } from '../schemas/managed-driver-contact.schemas.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import { saveDriverProfile } from '../../rides/repositories/driver.repository.js';
import type { UpsertDriverProfileInput } from '../../rides/schemas/driver.schemas.js';

export class ManagedDriverRepository {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      if (e && typeof e === 'object' && 'code' in e && e.code === '23505')
        throw new AppError(
          'DRIVER_CONTACT_OR_LICENCE_EXISTS',
          'Driver contact or licence already belongs to an account',
          409,
        );
      throw e;
    } finally {
      c.release();
    }
  }
  private async owner(c: Pick<Pool, 'query'>, id: string, role: string) {
    if (!['fleet_owner', 'driver_fleet_owner'].includes(role))
      throw new AppError('FORBIDDEN', 'Fleet Owner required', 403);
    const p = (
      await c.query(
        `SELECT p.id FROM partners p JOIN users u ON u.id=p.user_id
   WHERE p.user_id=$1 AND u.role::text=$2 AND u.status='active' AND u.deleted_at IS NULL`,
        [id, role],
      )
    ).rows[0];
    if (!p)
      throw new AppError(
        'BUSINESS_PROFILE_REQUIRED',
        'Save your Fleet business details before adding Driver profiles. Approval is required before assignment and operations.',
        409,
      );
    return p.id as string;
  }
  async authorizedProfile(
    owner: string,
    role: string,
    userId: string,
    c: Pick<Pool, 'query'> = this.pool,
  ) {
    const partner = await this.owner(c, owner, role);
    const profile = (
      await c.query(
        `SELECT dp.id,dp.user_id AS "userId",u.role FROM driver_profiles dp JOIN users u ON u.id=dp.user_id
   WHERE dp.user_id=$1 AND u.status='active' AND u.deleted_at IS NULL AND EXISTS(
    SELECT 1 FROM fleet_managed_driver_accounts m WHERE m.driver_user_id=u.id AND m.partner_id=$2 AND m.status='ACTIVE')`,
        [userId, partner],
      )
    ).rows[0];
    if (!profile)
      throw new AppError(
        'DRIVER_NOT_FOUND',
        'Managed Driver is not authorized for this Fleet',
        404,
      );
    return profile as { id: string; userId: string; role: string };
  }
  async list(owner: string, role: string) {
    const partner = await this.owner(this.pool, owner, role);
    return (
      await this.pool.query(
        `SELECT u.id AS "userId",dp.id AS "profileId",u.first_name AS "firstName",u.last_name AS "lastName",u.email,
   CASE WHEN m.provisioned_email IS NOT NULL OR m.provisioned_phone IS NOT NULL THEN 'fleet_provisioned' ELSE 'self_registered' END AS "accountOrigin",
   dp.verification_status AS "verificationStatus",dp.active_vehicle_id AS "vehicleId",m.onboarding_submitted_at AS "submittedAt"
   FROM fleet_managed_driver_accounts m JOIN users u ON u.id=m.driver_user_id JOIN driver_profiles dp ON dp.user_id=u.id
   WHERE m.partner_id=$1 AND m.status='ACTIVE' AND u.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 100`,
        [partner],
      )
    ).rows;
  }
  async create(
    owner: string,
    role: string,
    input: UpsertDriverProfileInput & {
      firstName: string;
      lastName: string;
      email?: string | undefined;
      phone?: string | undefined;
      driverUserId?: string | undefined;
    },
  ) {
    const contacts = managedDriverContactsSchema.parse(input);
    input = { ...input, ...contacts };
    return this.transaction(async (c) => {
      const partner = await this.owner(c, owner, role);
      // Lock both normalized identifiers in a stable order for concurrent retries.
      const keys = [input.email && `email:${input.email}`, input.phone && `phone:${input.phone}`]
        .filter((value): value is string => Boolean(value))
        .sort();
      for (const key of keys)
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended('managed_driver:'||$1,0))", [
          key,
        ]);
      const candidates = (
        await c.query(
          `SELECT id,role,email,phone,CASE WHEN EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m0 WHERE m0.driver_user_id=users.id AND (m0.provisioned_email IS NOT NULL OR m0.provisioned_phone IS NOT NULL)) THEN 'fleet_provisioned' ELSE 'self_registered' END AS "accountOrigin" FROM users WHERE deleted_at IS NULL
           AND role IN ('driver','driver_fleet_owner') AND (
             ($1::text IS NOT NULL AND lower(btrim(email))=$1) OR
             ($2::text IS NOT NULL AND ltrim(btrim(phone),'+')=ltrim($2,'+')))
           FOR UPDATE`,
          [input.email ?? null, input.phone ?? null],
        )
      ).rows;
      const existing = input.driverUserId
        ? candidates.filter((row) => row.id === input.driverUserId)
        : candidates;
      if (existing.length > 1)
        throw new AppError(
          'DRIVER_ACCOUNT_REQUIRED',
          'Choose the intended registered Driver account',
          409,
        );
      let user = existing[0];
      if (
        user &&
        ((input.driverUserId && input.driverUserId !== user.id) ||
          (input.email && input.email !== user.email?.trim().toLowerCase()) ||
          (input.phone && input.phone.replace(/^\+/, '') !== user.phone?.trim().replace(/^\+/, '')))
      )
        throw new AppError(
          'DRIVER_CONTACT_MISMATCH',
          'Use the registered Driver contacts; contact changes require ownership verification',
          409,
        );
      if (!user) {
        if (input.driverUserId)
          throw new AppError('DRIVER_NOT_FOUND', 'Registered Driver not found', 404);
        user = (
          await c.query(
            `INSERT INTO users(first_name,last_name,email,phone,role,email_verified)
     VALUES($1,$2,lower(btrim($3)),$4,'driver',FALSE) RETURNING id,role,'fleet_provisioned'::text AS "accountOrigin"`,
            [input.firstName, input.lastName, input.email ?? null, input.phone ?? null],
          )
        ).rows[0];
        await c.query(
          'INSERT INTO fleet_managed_driver_accounts(driver_user_id,partner_id,created_by,provisioned_email,provisioned_phone) VALUES($1,$2,$3,$4,$5)',
          [user.id, partner, owner, input.email ?? null, input.phone ?? null],
        );
        await c.query(
          'INSERT INTO provider_onboarding(user_id,role_flow_active,dashboard_deferred_at) VALUES($1,TRUE,NOW())',
          [user.id],
        );
      } else {
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('managed_driver_user:'||$1,0))",
          [user.id],
        );
        const permitted = await c.query(
          `SELECT 1 FROM fleet_managed_driver_accounts WHERE driver_user_id=$1 AND partner_id=$2 AND status='ACTIVE'
     UNION ALL SELECT 1 FROM driver_profiles dp JOIN partner_drivers pd ON pd.driver_profile_id=dp.id WHERE dp.user_id=$1 AND pd.partner_id=$2 AND pd.status='ACTIVE'
     UNION ALL SELECT 1 FROM driver_onboarding_invitations i WHERE i.driver_user_id=$1 AND i.partner_id=$2 AND i.status='CONSUMED' LIMIT 1`,
          [user.id, partner],
        );
        if (!permitted.rowCount)
          throw new AppError(
            'DRIVER_CONSENT_REQUIRED',
            'Invite the existing Driver and complete Fleet association before managing their profile',
            409,
          );
        const authority = await c.query(
          'SELECT partner_id,status FROM fleet_managed_driver_accounts WHERE driver_user_id=$1 FOR UPDATE',
          [user.id],
        );
        if (
          authority.rows[0] &&
          (authority.rows[0].partner_id !== partner || authority.rows[0].status !== 'ACTIVE')
        )
          throw new AppError(
            'DRIVER_MANAGED_ELSEWHERE',
            'Driver management belongs to another Fleet or was revoked',
            409,
          );
        await c.query(
          'INSERT INTO fleet_managed_driver_accounts(driver_user_id,partner_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [user.id, partner, owner],
        );
      }
      await c.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [owner]);
      const profile = await saveDriverProfile(c, user.id, input);
      await c.query(
        `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
    VALUES($1,'fleet_driver_profile_saved','driver_profile',$2,jsonb_build_object('driverUserId',$3::uuid,'partnerId',$4::uuid))`,
        [owner, profile.id, user.id, partner],
      );
      return {
        userId: user.id,
        profileId: profile.id,
        verificationStatus: profile.verificationStatus,
        activationRequired: true,
        accountOrigin: user.accountOrigin,
        authentication: 'Driver signs in using their own OTP; no Fleet password is created',
      };
    });
  }
  async update(owner: string, role: string, userId: string, input: UpsertDriverProfileInput) {
    return this.transaction(async (c) => {
      await this.authorizedProfile(owner, role, userId, c);
      await c.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [owner]);
      return saveDriverProfile(c, userId, input);
    });
  }
  async documentAccess(owner: string, role: string, userId: string, documentId: string) {
    const target = await this.authorizedProfile(owner, role, userId);
    const doc = (
      await this.pool.query(
        `SELECT storage_key AS "storageKey",resource_type AS "resourceType",access_mode AS "accessMode"
   FROM driver_documents WHERE id=$1 AND driver_profile_id=$2`,
        [documentId, target.id],
      )
    ).rows[0];
    if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 'Managed Driver document not found', 404);
    return doc;
  }
  async detail(owner: string, role: string, userId: string) {
    const target = await this.authorizedProfile(owner, role, userId);
    const profile = (
      await this.pool.query(
        `SELECT dp.id,u.id AS "userId",u.first_name AS "firstName",u.last_name AS "lastName",u.email,u.phone,
   dp.license_number AS "licenseNumber",dp.license_expiry::text AS "licenseExpiry",dp.verification_status AS "verificationStatus"
   FROM driver_profiles dp JOIN users u ON u.id=dp.user_id WHERE dp.id=$1`,
        [target.id],
      )
    ).rows[0];
    const documents = (
      await this.pool.query(
        `SELECT id,document_type AS "documentType",verification_status AS "verificationStatus",document_metadata AS metadata
   FROM driver_documents WHERE driver_profile_id=$1 ORDER BY document_type`,
        [target.id],
      )
    ).rows;
    const requirements = (
      await this.pool.query(
        `SELECT document_code,required,requires_expiry,minimum_pages,onboarding_deferrable,vehicle_category
   FROM provider_document_requirements WHERE active AND provider_role=$1 AND vehicle_category='*' ORDER BY document_code`,
        [target.role],
      )
    ).rows;
    const currentVehicle = await new PostgresDriverRepository(this.pool).getAssignedVehicle(
      target.id,
    );
    const assignedVehicle = currentVehicle?.owner?.id === owner ? currentVehicle : null;
    return {
      profile: { ...profile, vehicleId: assignedVehicle?.id ?? null, assignedVehicle },
      documents,
      requirements,
    };
  }

  async assign(owner: string, role: string, userId: string, code: string) {
    const target = await this.authorizedProfile(owner, role, userId);
    try {
      return await new PostgresDriverRepository(this.pool).claimAssignmentCode(
        code,
        userId,
        target.id,
        owner,
      );
    } catch (e) {
      if (
        e instanceof Error &&
        ['ASSIGNMENT_CODE_INVALID', 'DRIVER_ALREADY_ASSIGNED'].includes(e.message)
      )
        throw new AppError(
          e.message,
          'Check the vehicle code, Driver approval, Fleet association and vehicle availability',
          409,
        );
      throw e;
    }
  }
  async submit(owner: string, role: string, userId: string) {
    return this.transaction(async (c) => {
      const target = await this.authorizedProfile(owner, role, userId, c),
        partner = await this.owner(c, owner, role);
      await c.query('SELECT id FROM driver_profiles WHERE id=$1 FOR UPDATE', [target.id]);
      const membership = await c.query(
        `SELECT 1 FROM partner_drivers pd JOIN driver_profiles dp ON dp.id=pd.driver_profile_id
         WHERE pd.partner_id=$1 AND pd.driver_profile_id=$2 AND pd.status='ACTIVE'
           AND dp.verification_status='approved'`,
        [partner, target.id],
      );
      if (membership.rowCount)
        throw new AppError(
          'DRIVER_ALREADY_ASSOCIATED',
          'This approved Driver is already an active member of your Fleet',
          409,
        );
      const documents = await c.query(
        "SELECT id FROM driver_documents WHERE driver_profile_id=$1 AND document_type='driver_license' AND verification_status::text NOT IN ('rejected','expired','changes_requested')",
        [target.id],
      );
      if (!documents.rowCount)
        throw new AppError(
          'DRIVER_DOCUMENT_REQUIRED',
          'Upload the Driver licence before requesting review',
          409,
        );
      const requests = (
        await c.query(
          `INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id)
    VALUES($1,$2,$3,(SELECT CASE WHEN verification_status='approved' THEN 'driver_association' ELSE 'driver_verification' END FROM driver_profiles WHERE id=$4),'driver_profile',$4)
    ON CONFLICT(target_type,target_id,request_type) WHERE status='PENDING' DO UPDATE
      SET requester_id=EXCLUDED.requester_id,requester_role=EXCLUDED.requester_role,
          fleet_id=EXCLUDED.fleet_id,updated_at=NOW()
      WHERE (provider_approval_requests.fleet_id IS NULL OR provider_approval_requests.fleet_id=EXCLUDED.fleet_id)
        AND provider_approval_requests.requester_id IN (EXCLUDED.requester_id,(SELECT user_id FROM driver_profiles WHERE id=EXCLUDED.target_id))
    RETURNING id,status`,
          [owner, role, partner, target.id],
        )
      ).rows[0];
      if (!requests)
        throw new AppError(
          'APPROVAL_ALREADY_PENDING',
          'Another Fleet already submitted this Driver for review',
          409,
        );
      await c.query(
        'UPDATE fleet_managed_driver_accounts SET onboarding_submitted_at=NOW(),updated_at=NOW() WHERE driver_user_id=$1 AND partner_id=$2',
        [userId, partner],
      );
      await c.query(
        `UPDATE provider_onboarding SET dashboard_deferred_at=COALESCE(dashboard_deferred_at,NOW()),updated_at=NOW() WHERE user_id=$1`,
        [userId],
      );
      return {
        ...requests,
        profileId: target.id,
        verificationStatus: (
          await c.query('SELECT verification_status FROM driver_profiles WHERE id=$1', [target.id])
        ).rows[0].verification_status,
        message: 'Submitted for authorized review; this does not approve Driver operations',
      };
    });
  }
}
