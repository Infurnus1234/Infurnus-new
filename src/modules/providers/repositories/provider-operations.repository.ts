import { env } from '../../../config/env.js';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import type {
  StorageAccessMode,
  StorageResourceType,
} from '../../../infrastructure/storage/types.js';

export class PostgresProviderOperationsRepository {
  constructor(private readonly pool: Pool) {}

  private async authorizeReviewer(client: import('pg').PoolClient, actorId: string) {
    const actor = (
      await client.query<{ role: string }>(
        "SELECT role::text FROM users WHERE id=$1 AND role IN ('admin','super_admin') AND status='active' AND deleted_at IS NULL FOR SHARE",
        [actorId],
      )
    ).rows[0];
    if (!actor) throw new AppError('FORBIDDEN', 'Active administrator required', 403);
    return actor.role;
  }

  async documentPolicies(actorId: string) {
    const client = await this.pool.connect();
    try {
      await this.authorizeReviewer(client, actorId);
      return (
        await client.query(
          'SELECT id,provider_role,vehicle_category,document_code,required,requires_expiry,minimum_pages,active,updated_at FROM provider_document_requirements ORDER BY provider_role,vehicle_category,document_code LIMIT 1000',
        )
      ).rows;
    } finally {
      client.release();
    }
  }

  async pendingApprovals(actorId: string) {
    const client = await this.pool.connect();
    try {
      await this.authorizeReviewer(client, actorId);
      return (
        await client.query(
          "SELECT id,requester_id,requester_role,fleet_id,request_type,target_type,target_id,status,submitted_at FROM provider_approval_requests WHERE status='PENDING' AND target_type<>'bank_account' ORDER BY submitted_at,id LIMIT 100",
        )
      ).rows;
    } finally {
      client.release();
    }
  }

  async approvalDetails(actorId: string, id: string) {
    const client = await this.pool.connect();
    try {
      await this.authorizeReviewer(client, actorId);
      const row = (
        await client.query(
          "SELECT * FROM provider_approval_requests WHERE id=$1 AND target_type<>'bank_account'",
          [id],
        )
      ).rows[0];
      if (!row) throw new AppError('APPROVAL_NOT_FOUND', 'Approval not found', 404);
      const tables: Record<string, string> = {
        driver_profile: 'driver_profiles',
        driver_document: 'driver_documents',
        partner: 'partners',
        partner_document: 'partner_documents',
        vehicle: 'vehicles',
      };
      const target = (
        await client.query(
          `SELECT to_jsonb(t) AS data FROM ${tables[row.target_type]} t WHERE id=$1`,
          [row.target_id],
        )
      ).rows[0]?.data;
      if (!target) throw new AppError('TARGET_NOT_FOUND', 'Target no longer exists', 404);
      delete target.storage_key;
      if (target.metadata) {
        delete target.metadata.storage;
        delete target.metadata.pages;
      }
      const history = (
        await client.query(
          `SELECT id,status,reviewer_id,reviewed_at,rejection_reason,submitted_at FROM provider_approval_requests WHERE target_type=$1 AND target_id=$2 ORDER BY submitted_at DESC LIMIT 100`,
          [row.target_type, row.target_id],
        )
      ).rows;
      const documentScope =
        row.target_type === 'driver_profile' || row.target_type === 'driver_document'
          ? {
              table: 'driver_documents',
              column: 'driver_profile_id',
              value: target.driver_profile_id ?? target.id,
            }
          : {
              table: 'partner_documents',
              column: row.target_type === 'vehicle' ? 'vehicle_id' : 'partner_id',
              value: target.partner_id ?? target.id,
            };
      const documents = (
        await client.query(
          'SELECT to_jsonb(d) AS data FROM ' +
            documentScope.table +
            ' d WHERE ' +
            documentScope.column +
            '=$1 ORDER BY id LIMIT 100',
          [documentScope.value],
        )
      ).rows.map((row) => {
        const doc = row.data;
        doc.pageCount = Array.isArray(doc.metadata?.pages)
          ? Math.max(1, doc.metadata.pages.length)
          : 1;
        delete doc.storage_key;
        if (doc.metadata) {
          delete doc.metadata.storage;
          delete doc.metadata.pages;
        }
        return doc;
      });
      if (documentScope.table === 'driver_documents') {
        for (const doc of documents) {
          doc.pageCount = Math.max(
            1,
            Number(
              (
                await client.query(
                  'SELECT count(*) AS total FROM driver_document_pages WHERE document_id=$1 AND version=$2',
                  [doc.id, doc.version],
                )
              ).rows[0].total,
            ),
          );
        }
      }
      return { request: row, target, documents, history };
    } finally {
      client.release();
    }
  }

  async approvalDocumentAccess(
    actorId: string,
    requestId: string,
    documentId: string,
    page?: number,
  ) {
    const detail = await this.approvalDetails(actorId, requestId);
    if (!detail.documents.some((doc) => doc.id === documentId))
      throw new AppError('DOCUMENT_NOT_FOUND', 'Document is not related to this request', 404);
    if (
      detail.request.target_type === 'driver_profile' ||
      detail.request.target_type === 'driver_document'
    ) {
      const doc = (
        await this.pool.query(
          'SELECT storage_key,resource_type,version FROM driver_documents WHERE id=$1',
          [documentId],
        )
      ).rows[0];
      if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
      if (page) {
        const entry = (
          await this.pool.query(
            'SELECT storage_key,resource_type FROM driver_document_pages WHERE document_id=$1 AND version=$2 AND page_number=$3',
            [documentId, doc.version, page],
          )
        ).rows[0];
        if (!entry) throw new AppError('DOCUMENT_NOT_FOUND', 'Page not found', 404);
        return {
          storageKey: entry.storage_key,
          resourceType: entry.resource_type as StorageResourceType,
          accessMode: 'authenticated' as const,
        };
      }
      return {
        storageKey: doc.storage_key,
        resourceType: doc.resource_type as StorageResourceType,
        accessMode: 'authenticated' as const,
      };
    }
    const doc = (
      await this.pool.query('SELECT metadata FROM partner_documents WHERE id=$1', [documentId])
    ).rows[0];
    const storage = page ? doc?.metadata?.pages?.[page - 1] : doc?.metadata?.storage;
    if (!storage) throw new AppError('DOCUMENT_NOT_FOUND', 'Stored document/page not found', 404);
    return {
      storageKey: storage.storageKey,
      resourceType: storage.resourceType as StorageResourceType,
      accessMode: 'authenticated' as const,
    };
  }

  async reviewLegacyTarget(
    actorId: string | undefined,
    type: 'driver_profile' | 'vehicle' | 'partner_document',
    id: string,
    state: string,
    reason?: string,
  ) {
    if (!actorId) throw new AppError('AUTHENTICATION_REQUIRED', 'Reviewer identity required', 401);
    const status = state.toUpperCase();
    if (!['APPROVED', 'VERIFIED', 'REJECTED', 'PENDING', 'UNDER_REVIEW'].includes(status))
      throw new AppError('INVALID_VERIFICATION_STATUS', 'Unsupported verification status', 400);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.authorizeReviewer(client, actorId);
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [actorId]);
      const queries = {
        driver_profile:
          'SELECT t.*,t.updated_at::text AS version_timestamp,u.id AS owner,u.role AS owner_role FROM driver_profiles t JOIN users u ON u.id=t.user_id WHERE t.id=$1 OR t.user_id=$1 FOR UPDATE OF t',
        vehicle:
          'SELECT t.*,t.updated_at::text AS version_timestamp,u.id AS owner,u.role AS owner_role FROM vehicles t JOIN users u ON u.id=t.owner_id WHERE t.id=$1 FOR UPDATE OF t',
        partner_document:
          'SELECT t.*,t.updated_at::text AS version_timestamp,u.id AS owner,u.role AS owner_role FROM partner_documents t JOIN partners p ON p.id=t.partner_id JOIN users u ON u.id=p.user_id WHERE t.id=$1 FOR UPDATE OF t',
      };
      const target = (await client.query(queries[type], [id])).rows[0];
      if (!target) {
        await client.query('COMMIT');
        return false;
      }
      if (target.owner === actorId)
        throw new AppError('SELF_REVIEW_FORBIDDEN', 'Cannot review your own resource', 403);
      if (status === 'PENDING' || status === 'UNDER_REVIEW') {
        if (type !== 'driver_profile')
          throw new AppError(
            'INVALID_VERIFICATION_STATUS',
            'Use document replacement to request reverification',
            409,
          );
        await client.query(
          "UPDATE driver_profiles SET verification_status=$2,verified_by=NULL,verified_at=NULL,rejection_reason=NULL,availability_status='unavailable',updated_at=NOW() WHERE id=$1",
          [target.id, status.toLowerCase()],
        );
      } else {
        let request = (
          await client.query(
            "SELECT id FROM provider_approval_requests WHERE target_type=$1 AND target_id=$2 AND status='PENDING' ORDER BY submitted_at LIMIT 1 FOR UPDATE",
            [type, target.id],
          )
        ).rows[0];
        if (!request) {
          request = (
            await client.query(
              `INSERT INTO provider_approval_requests(requester_id,requester_role,request_type,target_type,target_id,metadata)
            VALUES($1,$2,$3,$4,$5,jsonb_build_object('legacyReviewerId',$6::text)) RETURNING id`,
              [
                target.owner,
                target.owner_role,
                type === 'driver_profile'
                  ? 'driver_verification'
                  : type === 'vehicle'
                    ? 'vehicle_verification'
                    : 'document_reverification',
                type,
                target.id,
                actorId,
              ],
            )
          ).rows[0];
        }
        await this.reviewApproval(
          actorId,
          request.id,
          {
            status: status === 'REJECTED' ? 'REJECTED' : 'APPROVED',
            reason,
            expectedUpdatedAt: target.version_timestamp,
          },
          client,
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reviewApproval(
    actorId: string,
    id: string,
    input: {
      status: 'APPROVED' | 'REJECTED';
      reason?: string | undefined;
      expectedUpdatedAt: string;
    },
    existingClient?: PoolClient,
  ) {
    const client = existingClient ?? (await this.pool.connect());
    try {
      if (!existingClient) await client.query('BEGIN');
      const reviewerRole = await this.authorizeReviewer(client, actorId);
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [actorId]);
      const request = (
        await client.query(
          "SELECT * FROM provider_approval_requests WHERE id=$1 AND target_type<>'bank_account'",
          [id],
        )
      ).rows[0];
      if (!request) throw new AppError('APPROVAL_NOT_FOUND', 'Approval not found', 404);
      if (request.requester_id === actorId)
        throw new AppError('SELF_REVIEW_FORBIDDEN', 'Cannot review your own request', 403);
      if (request.status !== 'PENDING')
        throw new AppError('APPROVAL_ALREADY_REVIEWED', 'Request is no longer pending', 409);
      if (input.status === 'REJECTED' && !input.reason?.trim())
        throw new AppError('REJECTION_REASON_REQUIRED', 'Rejection reason required', 400);
      const tables: Record<string, string> = {
        driver_profile: 'driver_profiles',
        driver_document: 'driver_documents',
        partner: 'partners',
        partner_document: 'partner_documents',
        vehicle: 'vehicles',
      };
      const target = (
        await client.query(`SELECT * FROM ${tables[request.target_type]} WHERE id=$1 FOR UPDATE`, [
          request.target_id,
        ])
      ).rows[0];
      if (!target) throw new AppError('TARGET_NOT_FOUND', 'Target no longer exists', 404);
      const locked = (
        await client.query('SELECT status FROM provider_approval_requests WHERE id=$1 FOR UPDATE', [
          id,
        ])
      ).rows[0];
      if (locked?.status !== 'PENDING')
        throw new AppError('APPROVAL_ALREADY_REVIEWED', 'Request is no longer pending', 409);
      if (
        !(
          await client.query(
            'SELECT updated_at=$2::timestamptz AS matches FROM ' +
              tables[request.target_type] +
              ' WHERE id=$1',
            [target.id, input.expectedUpdatedAt],
          )
        ).rows[0]?.matches
      )
        throw new AppError('TARGET_CHANGED', 'Target changed; inspect it again', 409);
      let owner = target.user_id ?? target.owner_id;
      if (request.target_type === 'driver_document')
        owner = (
          await client.query(`SELECT user_id FROM driver_profiles WHERE id=$1`, [
            target.driver_profile_id,
          ])
        ).rows[0]?.user_id;
      if (request.target_type === 'partner_document')
        owner = (
          await client.query(`SELECT user_id FROM partners WHERE id=$1`, [target.partner_id])
        ).rows[0]?.user_id;
      if (owner === actorId)
        throw new AppError('SELF_REVIEW_FORBIDDEN', 'Cannot review your own resource', 403);
      const approved = input.status === 'APPROVED',
        state = approved ? 'approved' : 'rejected';
      if (approved && ['driver_document', 'partner_document'].includes(request.target_type)) {
        const isDriver = request.target_type === 'driver_document';
        const code = isDriver
          ? (target.document_metadata?.documentCode ?? target.document_type)
          : (target.metadata?.documentCode ?? target.document_type.toLowerCase());
        const category =
          (
            await client.query(
              isDriver
                ? 'SELECT v.category FROM driver_profiles dp LEFT JOIN vehicles v ON v.id=dp.active_vehicle_id WHERE dp.id=$1'
                : 'SELECT category FROM vehicles WHERE id=$1',
              [isDriver ? target.driver_profile_id : target.vehicle_id],
            )
          ).rows[0]?.category ?? '*';
        const policy = (
          await client.query(
            `SELECT r.requires_expiry,r.minimum_pages FROM provider_document_requirements r JOIN users u ON u.role::text=r.provider_role
          WHERE u.id=$1 AND r.active AND r.document_code=$2 AND r.vehicle_category IN('*',$3)`,
            [owner, code, category],
          )
        ).rows;
        const expiry = isDriver ? target.document_metadata?.expiresAt : target.expires_at;
        const pages = isDriver
          ? Number(
              (
                await client.query(
                  'SELECT count(*) AS total FROM driver_document_pages WHERE document_id=$1 AND version=$2',
                  [target.id, target.version],
                )
              ).rows[0].total,
            )
          : Array.isArray(target.metadata?.pages)
            ? target.metadata.pages.length
            : 1;
        if (
          policy.some(
            (rule) => (rule.requires_expiry && !expiry) || Math.max(1, pages) < rule.minimum_pages,
          )
        )
          throw new AppError(
            'DOCUMENT_REQUIREMENTS_NOT_MET',
            'Document expiry/pages do not satisfy configured policy',
            409,
          );
      }

      if (
        approved &&
        ['driver_profile', 'partner', 'vehicle'].includes(request.target_type) &&
        request.request_type !== 'driver_association'
      ) {
        const profile = request.target_type === 'driver_profile' ? target.id : null;
        const vehicle = request.target_type === 'vehicle' ? target.id : null;
        const fleet =
          request.target_type === 'partner'
            ? target.id
            : ((await client.query('SELECT id FROM partners WHERE user_id=$1', [owner])).rows[0]
                ?.id ?? null);
        const compliance = (
          await client.query('SELECT provider_compliance_satisfied($1,$2,$3,$4,$5) AS ok', [
            owner,
            profile,
            fleet,
            vehicle,
            target.category ?? '*',
          ])
        ).rows[0];
        if (!compliance?.ok)
          throw new AppError(
            'DOCUMENT_REQUIREMENTS_NOT_MET',
            'Configured required documents must be approved and valid',
            409,
          );
      }
      if (request.request_type === 'driver_association') {
        if (approved) {
          const fleet = (
            await client.query(
              "SELECT user_id FROM partners WHERE id=$1 AND approval_status='approved' FOR SHARE",
              [request.fleet_id],
            )
          ).rows[0];
          if (
            !fleet ||
            target.verification_status !== 'approved' ||
            new Date(target.license_expiry).toISOString().slice(0, 10) <
              new Date().toISOString().slice(0, 10)
          )
            throw new AppError(
              'DRIVER_NOT_ELIGIBLE',
              'Approved fleet and eligible driver required',
              409,
            );
          await client.query(
            "INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES($1,$2) ON CONFLICT(partner_id,driver_profile_id) DO UPDATE SET status='ACTIVE',updated_at=NOW()",
            [request.fleet_id, target.id],
          );
        }
      } else if (request.target_type === 'driver_profile') {
        if (
          approved &&
          new Date(target.license_expiry).toISOString().slice(0, 10) <
            new Date().toISOString().slice(0, 10)
        )
          throw new AppError('DOCUMENT_EXPIRED', 'Licence is expired', 409);
        await client.query(
          `UPDATE driver_profiles SET verification_status=$2,verified_by=$3,verified_at=NOW(),rejection_reason=$4,updated_at=NOW() WHERE id=$1`,
          [target.id, state, actorId, approved ? null : input.reason],
        );
      } else if (request.target_type === 'driver_document') {
        const expiry = target.document_metadata?.expiresAt;
        if (approved && expiry && expiry < new Date().toISOString().slice(0, 10))
          throw new AppError('DOCUMENT_EXPIRED', 'Document is expired', 409);
        await client.query(
          `UPDATE driver_documents SET verification_status=$2,verified_by=$3,verified_at=NOW(),rejection_reason=$4,updated_at=NOW() WHERE id=$1`,
          [target.id, state, actorId, approved ? null : input.reason],
        );
      } else if (request.target_type === 'partner') {
        await client.query(
          `UPDATE partners SET approval_status=$2,reviewed_by=$3,reviewed_at=NOW(),approved_by=CASE WHEN $2='approved' THEN $3::uuid ELSE NULL END,approved_at=CASE WHEN $2='approved' THEN NOW() ELSE NULL END,rejection_reason=$4,updated_at=NOW() WHERE id=$1`,
          [target.id, state, actorId, approved ? null : input.reason],
        );
      } else if (request.target_type === 'vehicle') {
        if (
          approved &&
          target.registration_expiry &&
          new Date(target.registration_expiry).toISOString().slice(0, 10) <
            new Date().toISOString().slice(0, 10)
        )
          throw new AppError('DOCUMENT_EXPIRED', 'Registration is expired', 409);
        await client.query(
          `UPDATE vehicles SET verification_status=$2,verified_by=$3,verified_at=NOW(),is_active=FALSE,updated_at=NOW() WHERE id=$1`,
          [target.id, state, actorId],
        );
      } else {
        if (
          approved &&
          target.expires_at &&
          new Date(target.expires_at).toISOString().slice(0, 10) <
            new Date().toISOString().slice(0, 10)
        )
          throw new AppError('DOCUMENT_EXPIRED', 'Document is expired', 409);
        if (target.status !== 'SUBMITTED')
          await client.query("UPDATE partner_documents SET status='SUBMITTED' WHERE id=$1", [
            target.id,
          ]);
        await client.query(
          `UPDATE partner_documents SET status=$2,reviewed_by=$3,reviewed_at=NOW(),verified_at=CASE WHEN $2::partner_document_status='VERIFIED' THEN NOW() ELSE NULL END,metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('rejectionReason',$4::text),updated_at=NOW() WHERE id=$1`,
          [target.id, approved ? 'VERIFIED' : 'REJECTED', actorId, approved ? null : input.reason],
        );
      }
      await client.query(
        `UPDATE provider_approval_requests SET status=$2,reviewer_id=$3,reviewer_role=$4,reviewed_at=NOW(),rejection_reason=$5,updated_at=NOW() WHERE id=$1`,
        [id, input.status, actorId, reviewerRole, approved ? null : input.reason],
      );
      if (!existingClient) await client.query('COMMIT');
      return { id, status: input.status };
    } catch (error) {
      if (!existingClient) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (!existingClient) client.release();
    }
  }

  async deactivateMembership(userId: string, role: string, profileId: string) {
    if (!['fleet_owner', 'driver_fleet_owner'].includes(role))
      throw new AppError('FORBIDDEN', 'Fleet access required', 403);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [userId]);
      const actor = (
        await client.query(
          "SELECT p.id FROM partners p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND u.role::text=$2 AND u.status='active' AND u.deleted_at IS NULL AND p.approval_status='approved' FOR SHARE OF p,u",
          [userId, role],
        )
      ).rows[0];
      if (!actor) throw new AppError('FORBIDDEN', 'Approved active fleet required', 403);
      const ownedVehicles = (
        await client.query(
          'SELECT id FROM vehicles WHERE owner_id=$1 AND driver_profile_id=$2 ORDER BY id',
          [userId, profileId],
        )
      ).rows;
      for (const vehicle of ownedVehicles)
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('provider_vehicle:'||$1::text,0))",
          [vehicle.id],
        );
      const driver = (
        await client.query(
          'SELECT availability_status FROM driver_profiles WHERE id=$1 FOR UPDATE',
          [profileId],
        )
      ).rows[0];
      const membership = (
        await client.query(
          'SELECT id FROM partner_drivers WHERE partner_id=$1 AND driver_profile_id=$2 FOR UPDATE',
          [actor.id, profileId],
        )
      ).rows[0];
      if (!membership) throw new AppError('DRIVER_NOT_FOUND', 'Fleet driver not found', 404);
      if (driver?.availability_status === 'busy')
        throw new AppError('DRIVER_BUSY', 'Busy driver membership cannot be removed', 409);
      const vehicles = (
        await client.query(
          'SELECT id FROM vehicles WHERE owner_id=$1 AND driver_profile_id=$2 FOR UPDATE',
          [userId, profileId],
        )
      ).rows;
      for (const vehicle of vehicles) {
        await client.query(
          "UPDATE driver_assignment_codes SET status='REVOKED',updated_at=NOW() WHERE vehicle_id=$1 AND status='ACTIVE'",
          [vehicle.id],
        );
        await client.query(
          'UPDATE vehicles SET driver_profile_id=NULL,updated_at=NOW() WHERE id=$1',
          [vehicle.id],
        );
      }
      await client.query(
        "UPDATE driver_profiles SET active_vehicle_id=NULL,availability_status='unavailable',updated_at=NOW() WHERE id=$1 AND (active_vehicle_id IS NULL OR active_vehicle_id=ANY($2::uuid[]))",
        [profileId, vehicles.map((v) => v.id)],
      );
      await client.query(
        "UPDATE partner_drivers SET status='INACTIVE',updated_at=NOW() WHERE id=$1",
        [membership.id],
      );
      await client.query(
        "INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'fleet_membership_deactivated','partner_driver',$2,jsonb_build_object('driverProfileId',$3::uuid))",
        [userId, membership.id, profileId],
      );
      await client.query('COMMIT');
      return { id: membership.id, status: 'INACTIVE' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async manageVehicle(
    userId: string,
    role: string,
    id: string,
    input: {
      operationalStatus?: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | undefined;
      maintenanceNotes?: string | undefined;
      lastServiceDate?: string | undefined;
      nextServiceDate?: string | undefined;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('provider_vehicle:'||$1::text,0))",
        [id],
      );
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [userId]);
      const result = await client.query<{
        driver_profile_id: string | null;
        verification_status: string;
        registration_expiry: string | null;
        last_service_date: string | null;
        next_service_date: string | null;
      }>(
        `SELECT v.driver_profile_id,v.verification_status,v.registration_expiry::text,v.last_service_date::text,v.next_service_date::text FROM vehicles v JOIN users u ON u.id=v.owner_id
         WHERE v.id=$1 AND v.owner_id=$2 AND u.role::text=$3 AND u.status='active' AND u.deleted_at IS NULL FOR UPDATE OF v`,
        [id, userId, role],
      );
      const vehicle = result.rows[0];
      if (!vehicle) throw new AppError('VEHICLE_NOT_FOUND', 'Owned vehicle not found', 404);
      const last = input.lastServiceDate ?? vehicle.last_service_date;
      const next = input.nextServiceDate ?? vehicle.next_service_date;
      if (last && next && next < last)
        throw new AppError(
          'INVALID_SERVICE_DATE',
          'Next service date precedes previous service',
          400,
        );
      if (input.operationalStatus === 'ACTIVE') {
        const fleet = await client.query(
          "SELECT id FROM partners WHERE user_id=$1 AND approval_status='approved' FOR SHARE",
          [userId],
        );
        if (
          !fleet.rowCount ||
          vehicle.verification_status !== 'approved' ||
          (vehicle.registration_expiry &&
            vehicle.registration_expiry < new Date().toISOString().slice(0, 10))
        )
          throw new AppError(
            'VEHICLE_NOT_ELIGIBLE',
            'Approved fleet, vehicle and valid registration are required',
            409,
          );
      }
      if (
        input.operationalStatus &&
        input.operationalStatus !== 'ACTIVE' &&
        vehicle.driver_profile_id
      ) {
        const driver = await client.query<{ availability_status: string }>(
          'SELECT availability_status FROM driver_profiles WHERE id=$1 FOR UPDATE',
          [vehicle.driver_profile_id],
        );
        if (driver.rows[0]?.availability_status === 'busy')
          throw new AppError('DRIVER_BUSY', 'Busy vehicle cannot be deactivated', 409);
        await client.query(
          "UPDATE driver_profiles SET active_vehicle_id=NULL,availability_status='unavailable' WHERE id=$1 AND active_vehicle_id=$2",
          [vehicle.driver_profile_id, id],
        );
        await client.query(
          "UPDATE driver_assignment_codes SET status='REVOKED',updated_at=NOW() WHERE vehicle_id=$1 AND status='ACTIVE'",
          [id],
        );
      }
      const updated = await client.query(
        `UPDATE vehicles SET operational_status=COALESCE($3,operational_status),maintenance_notes=COALESCE($4,maintenance_notes),
         last_service_date=COALESCE($5::date,last_service_date),next_service_date=COALESCE($6::date,next_service_date),
         is_active=CASE WHEN $3 IS NULL THEN is_active ELSE $3='ACTIVE' END,
         driver_profile_id=CASE WHEN $3 IN ('INACTIVE','MAINTENANCE') THEN NULL ELSE driver_profile_id END,
         retired_at=CASE WHEN $3='ACTIVE' THEN NULL WHEN $3 IN ('INACTIVE','MAINTENANCE') THEN NOW() ELSE retired_at END,updated_at=NOW()
         WHERE id=$1 AND owner_id=$2 RETURNING id,is_active,verification_status,operational_status,maintenance_notes,last_service_date,next_service_date`,
        [
          id,
          userId,
          input.operationalStatus ?? null,
          input.maintenanceNotes ?? null,
          input.lastServiceDate ?? null,
          input.nextServiceDate ?? null,
        ],
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async documentRequirements(userId: string, role: string, category: string) {
    await this.authorize(userId, role);
    return (
      await this.pool.query(
        `SELECT document_code,required,requires_expiry,minimum_pages,vehicle_category FROM provider_document_requirements WHERE active=TRUE AND provider_role=$1 AND vehicle_category IN ('*',$2) ORDER BY document_code`,
        [role, category],
      )
    ).rows;
  }

  async requestApproval(
    userId: string,
    role: string,
    input: {
      targetType:
        | 'driver_profile'
        | 'driver_document'
        | 'partner'
        | 'partner_document'
        | 'vehicle'
        | 'bank_account';
      targetId: string;
      requestType: string;
    },
  ) {
    const allowed: Record<string, readonly string[]> = {
      driver_profile: [
        'driver_onboarding',
        'driver_verification',
        'licence_verification',
        'profile_verification',
        'compliance_review',
        'account_activation',
        'driver_association',
      ],
      driver_document: [
        'identity_verification',
        'licence_verification',
        'rc_verification',
        'profile_verification',
        'document_reverification',
        'compliance_review',
      ],
      partner: [
        'fleet_verification',
        'profile_verification',
        'compliance_review',
        'account_activation',
      ],
      partner_document: [
        'identity_verification',
        'licence_verification',
        'rc_verification',
        'insurance_verification',
        'puc_verification',
        'document_reverification',
        'compliance_review',
      ],
      vehicle: ['vehicle_verification', 'compliance_review', 'account_activation'],
      bank_account: ['bank_verification'],
    };
    if (!allowed[input.targetType]?.includes(input.requestType))
      throw new AppError('INVALID_APPROVAL_TYPE', 'Approval type does not apply to target', 400);
    await this.authorize(userId, role);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('infurnus.actor_id',$1,TRUE)", [userId]);
      const fleet = (
        await client.query<{ id: string; approval_status: string }>(
          'SELECT id,approval_status::text FROM partners WHERE user_id=$1 FOR SHARE',
          [userId],
        )
      ).rows[0];
      let permitted = false;
      let previousState: unknown = {};
      if (input.requestType === 'driver_association') {
        if (
          input.targetType !== 'driver_profile' ||
          !['fleet_owner', 'driver_fleet_owner'].includes(role) ||
          fleet?.approval_status !== 'approved'
        )
          throw new AppError('FORBIDDEN', 'Approved fleet access is required', 403);
        const driver = await client.query(
          "SELECT dp.id FROM driver_profiles dp JOIN users u ON u.id=dp.user_id WHERE dp.id=$1 AND dp.verification_status='approved' AND dp.license_expiry>=CURRENT_DATE AND u.status='active' AND u.deleted_at IS NULL AND u.role IN ('driver','driver_fleet_owner') FOR SHARE OF dp,u",
          [input.targetId],
        );
        permitted = Boolean(driver.rowCount);
      } else {
        const queries = {
          driver_profile:
            'SELECT id,verification_status::text AS state FROM driver_profiles WHERE id=$1 AND user_id=$2 FOR SHARE',
          driver_document:
            'SELECT d.id,d.verification_status::text AS state FROM driver_documents d JOIN driver_profiles dp ON dp.id=d.driver_profile_id WHERE d.id=$1 AND dp.user_id=$2 FOR SHARE OF d',
          partner:
            'SELECT id,approval_status::text AS state FROM partners WHERE id=$1 AND user_id=$2 FOR SHARE',
          partner_document:
            'SELECT d.id,d.status::text AS state FROM partner_documents d JOIN partners p ON p.id=d.partner_id WHERE d.id=$1 AND p.user_id=$2 FOR SHARE OF d',
          vehicle:
            'SELECT id,verification_status::text AS state FROM vehicles WHERE id=$1 AND owner_id=$2 FOR SHARE',
          bank_account:
            'SELECT id,is_verified AS state FROM provider_bank_accounts WHERE id=$1 AND user_id=$2 FOR SHARE',
        };
        const target = await client.query(queries[input.targetType], [input.targetId, userId]);
        permitted = Boolean(target.rowCount);
        previousState = target.rows[0] ?? {};
      }
      if (!permitted)
        throw new AppError('TARGET_NOT_FOUND', 'Approval target is not authorized', 404);
      const request = await client.query(
        `INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id,previous_state)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(target_type,target_id,request_type) WHERE status='PENDING'
         DO UPDATE SET updated_at=provider_approval_requests.updated_at WHERE provider_approval_requests.requester_id=EXCLUDED.requester_id
         RETURNING id,status,request_type,target_type,target_id`,
        [
          userId,
          role,
          fleet?.id ?? null,
          input.requestType,
          input.targetType,
          input.targetId,
          previousState,
        ],
      );
      if (!request.rowCount)
        throw new AppError(
          'APPROVAL_ALREADY_PENDING',
          'Target already has an approval request',
          409,
        );
      await client.query('COMMIT');
      return request.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async authorize(userId: string, role: string) {
    const result = await this.pool.query(
      "SELECT id FROM users WHERE id=$1 AND role::text=$2 AND status='active' AND deleted_at IS NULL",
      [userId, role],
    );
    if (!result.rowCount) throw new AppError('FORBIDDEN', 'Account is not authorized', 403);
  }

  async tracking(userId: string, role: string) {
    if (!['fleet_owner', 'driver_fleet_owner'].includes(role))
      throw new AppError('FORBIDDEN', 'Fleet owner access required', 403);
    await this.authorize(userId, role);
    const result = await this.pool.query(
      `SELECT dp.id AS "driverProfileId",dp.user_id AS "driverUserId",v.id AS "vehicleId",v.plate_number AS "plateNumber",
       dp.availability_status AS availability,dp.verification_status AS verification,
       ST_Y(dp.last_location::geometry) AS latitude,ST_X(dp.last_location::geometry) AS longitude,
       dp.last_location_at AS "recordedAt",dp.location_speed AS speed,dp.location_heading AS heading,dp.location_accuracy AS accuracy,
       CASE WHEN dp.last_location_at IS NULL OR dp.last_location_at < NOW()-($2::int*INTERVAL '1 second') THEN TRUE ELSE FALSE END AS stale,
       CASE WHEN dp.last_location_at >= NOW()-($2::int*INTERVAL '1 second') AND dp.availability_status IN ('available','busy')
         AND dp.verification_status='approved' AND u.status='active' AND u.deleted_at IS NULL THEN TRUE ELSE FALSE END AS online
       FROM partners p JOIN partner_drivers pd ON pd.partner_id=p.id AND pd.status='ACTIVE'
       JOIN driver_profiles dp ON dp.id=pd.driver_profile_id JOIN users u ON u.id=dp.user_id
       LEFT JOIN vehicles v ON v.owner_id=p.user_id AND v.driver_profile_id=dp.id AND v.is_active=TRUE
       WHERE p.user_id=$1 AND p.approval_status='approved' ORDER BY dp.id LIMIT 1000`,
      [userId, env.DRIVER_LOCATION_STALE_SECONDS],
    );
    return result.rows;
  }

  async ownLocation(userId: string, role: string) {
    await this.authorize(userId, role);
    if (!['driver', 'driver_fleet_owner'].includes(role))
      throw new AppError('FORBIDDEN', 'Driver access required', 403);
    return (
      (
        await this.pool.query(
          `SELECT id AS "driverProfileId",ST_Y(last_location::geometry) AS latitude,ST_X(last_location::geometry) AS longitude,
       last_location_at AS "recordedAt",location_speed AS speed,location_heading AS heading,location_accuracy AS accuracy,
       availability_status AS availability FROM driver_profiles WHERE user_id=$1`,
          [userId],
        )
      ).rows[0] ?? null
    );
  }

  private async driverAccess(userId: string, role: string, profileId: string) {
    await this.authorize(userId, role);
    const profile = (
      await this.pool.query(
        `SELECT dp.id,dp.user_id FROM driver_profiles dp WHERE dp.id=$2 AND
       (dp.user_id=$1 OR ($3::text IN ('fleet_owner','driver_fleet_owner') AND EXISTS(
         SELECT 1 FROM partners p JOIN partner_drivers pd ON pd.partner_id=p.id
         WHERE p.user_id=$1 AND pd.driver_profile_id=dp.id AND pd.status='ACTIVE')))`,
        [userId, profileId, role],
      )
    ).rows[0];
    if (!profile) throw new AppError('DRIVER_NOT_FOUND', 'Authorized driver not found', 404);
    return profile;
  }

  async driverProfile(userId: string, role: string, profileId: string) {
    await this.driverAccess(userId, role, profileId);
    return (
      await this.pool.query(
        `SELECT dp.id,dp.user_id AS "userId",u.first_name AS "firstName",u.last_name AS "lastName",u.phone,u.email,
       dp.license_number AS "licenseNumber",dp.license_expiry AS "licenseExpiry",dp.verification_status AS "verificationStatus",dp.availability_status AS availability,
       dp.city,dp.state,dp.pin_code AS "postalCode",dp.emergency_contact_name AS "emergencyContactName",dp.emergency_contact_phone AS "emergencyContactPhone",
       dp.emergency_contact_relationship AS "emergencyContactRelationship",dp.active_vehicle_id AS "vehicleId"
       FROM driver_profiles dp JOIN users u ON u.id=dp.user_id WHERE dp.id=$1 AND (dp.user_id=$2 OR ($3::text IN ('fleet_owner','driver_fleet_owner') AND EXISTS(SELECT 1 FROM partners p JOIN partner_drivers pd ON pd.partner_id=p.id WHERE p.user_id=$2 AND p.approval_status='approved' AND pd.driver_profile_id=dp.id AND pd.status='ACTIVE'))) AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=$2 AND actor.role::text=$3 AND actor.status='active' AND actor.deleted_at IS NULL)`,
        [profileId, userId, role],
      )
    ).rows[0];
  }

  async driverDocuments(userId: string, role: string, profileId: string) {
    await this.driverAccess(userId, role, profileId);
    return (
      await this.pool.query(
        `SELECT id,document_type AS "documentType",verification_status AS status,version,upload_source AS "uploadSource",document_metadata AS metadata,verified_at AS "verifiedAt",rejection_reason AS "rejectionReason"
       FROM driver_documents WHERE driver_profile_id=$1 AND EXISTS(SELECT 1 FROM driver_profiles dp WHERE dp.id=driver_profile_id AND (dp.user_id=$2 OR ($3::text IN ('fleet_owner','driver_fleet_owner') AND EXISTS(SELECT 1 FROM partners p JOIN partner_drivers pd ON pd.partner_id=p.id WHERE p.user_id=$2 AND p.approval_status='approved' AND pd.driver_profile_id=dp.id AND pd.status='ACTIVE'))) AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=$2 AND actor.role::text=$3 AND actor.status='active' AND actor.deleted_at IS NULL)) ORDER BY document_type,id LIMIT 100`,
        [profileId, userId, role],
      )
    ).rows;
  }

  async driverDocumentAccess(userId: string, role: string, profileId: string, id: string) {
    await this.driverAccess(userId, role, profileId);
    const document = (
      await this.pool.query<{
        storageKey: string;
        resourceType: StorageResourceType;
        accessMode: StorageAccessMode;
      }>(
        `SELECT storage_key AS "storageKey",resource_type AS "resourceType",access_mode AS "accessMode" FROM driver_documents WHERE id=$4 AND driver_profile_id=$1 AND EXISTS(SELECT 1 FROM driver_profiles dp WHERE dp.id=driver_profile_id AND (dp.user_id=$2 OR ($3::text IN ('fleet_owner','driver_fleet_owner') AND EXISTS(SELECT 1 FROM partners p JOIN partner_drivers pd ON pd.partner_id=p.id WHERE p.user_id=$2 AND p.approval_status='approved' AND pd.driver_profile_id=dp.id AND pd.status='ACTIVE'))) AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=$2 AND actor.role::text=$3 AND actor.status='active' AND actor.deleted_at IS NULL))`,
        [profileId, userId, role, id],
      )
    ).rows[0];
    if (!document) throw new AppError('DOCUMENT_NOT_FOUND', 'Authorized document not found', 404);
    return document;
  }

  async locationHistory(userId: string, role: string, profileId: string) {
    await this.authorize(userId, role);
    const result = await this.pool.query(
      `SELECT h.recorded_at AS "recordedAt",ST_Y(h.location::geometry) AS latitude,ST_X(h.location::geometry) AS longitude,
       h.vehicle_id AS "vehicleId",h.speed,h.heading,h.accuracy
       FROM provider_location_history h JOIN driver_profiles dp ON dp.id=h.driver_profile_id
       WHERE dp.id=$2 AND (dp.user_id=$1 OR (
         $3::text IN ('fleet_owner','driver_fleet_owner') AND EXISTS(
           SELECT 1 FROM partners p JOIN partner_drivers pd ON pd.partner_id=p.id
           WHERE p.user_id=$1 AND pd.driver_profile_id=dp.id AND pd.status='ACTIVE' AND h.fleet_id=p.id)))
       ORDER BY h.recorded_at DESC LIMIT 1000`,
      [userId, profileId, role],
    );
    return result.rows;
  }

  async approvals(userId: string, role: string) {
    await this.authorize(userId, role);
    return (
      await this.pool.query(
        `SELECT id,request_type,target_type,target_id,status,submitted_at,reviewed_at,rejection_reason,requested_changes,created_at,updated_at
       FROM provider_approval_requests WHERE requester_id=$1 ORDER BY submitted_at DESC,id DESC LIMIT 100`,
        [userId],
      )
    ).rows;
  }

  async approval(userId: string, role: string, id: string) {
    await this.authorize(userId, role);
    const row = (
      await this.pool.query(
        `SELECT id,request_type,target_type,target_id,status,submitted_at,reviewed_at,rejection_reason,requested_changes,created_at,updated_at
       FROM provider_approval_requests WHERE id=$1 AND requester_id=$2`,
        [id, userId],
      )
    ).rows[0];
    if (!row) throw new AppError('APPROVAL_NOT_FOUND', 'Approval request not found', 404);
    return row;
  }

  async configureDocumentRequirement(
    actorId: string,
    input: {
      providerRole: string;
      category: string;
      documentCode: string;
      required: boolean;
      requiresExpiry: boolean;
      minimumPages: number;
      active: boolean;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role IN ('admin','super_admin') AND status='active' AND deleted_at IS NULL FOR SHARE",
        [actorId],
      );
      if (!actor.rowCount)
        throw new AppError(
          'FORBIDDEN',
          'Document policy configuration requires an authorized operator',
          403,
        );
      if (
        !['driver', 'fleet_owner', 'driver_fleet_owner'].includes(input.providerRole) ||
        !input.category.trim() ||
        input.category.length > 50 ||
        !input.documentCode.trim() ||
        input.documentCode.length > 50 ||
        !Number.isInteger(input.minimumPages) ||
        input.minimumPages < 1 ||
        input.minimumPages > 5
      )
        throw new AppError('INVALID_DOCUMENT_POLICY', 'Invalid document policy', 400);
      const result = await client.query(
        `INSERT INTO provider_document_requirements(provider_role,vehicle_category,document_code,required,requires_expiry,minimum_pages,active,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(provider_role,vehicle_category,document_code) DO UPDATE SET required=EXCLUDED.required,requires_expiry=EXCLUDED.requires_expiry,minimum_pages=EXCLUDED.minimum_pages,active=EXCLUDED.active,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING id`,
        [
          input.providerRole,
          input.category,
          input.documentCode,
          input.required,
          input.requiresExpiry,
          input.minimumPages,
          input.active,
          actorId,
        ],
      );
      await client.query(
        "INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'document_policy_updated','document_requirement',$2,$3)",
        [actorId, result.rows[0].id, input],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async associationHistory(userId: string, role: string, vehicleId: string) {
    await this.authorize(userId, role);
    return (
      await this.pool.query(
        `SELECT h.id,h.previous_driver_profile_id,h.driver_profile_id,h.created_at
       FROM provider_vehicle_association_history h JOIN vehicles v ON v.id=h.vehicle_id
       WHERE v.id=$2 AND v.owner_id=$1 ORDER BY h.created_at DESC LIMIT 100`,
        [userId, vehicleId],
      )
    ).rows;
  }

  async earnings(userId: string, role: string) {
    await this.authorize(userId, role);
    // Settlement ledger is authoritative for commissions/net paid. Do not
    // manufacture a percentage or equate estimated booking fare with a payout.
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(amount_paise) FILTER(WHERE entry_type='EARNING'),0)::text AS "grossPaise",
       COALESCE(-SUM(amount_paise) FILTER(WHERE entry_type='COMMISSION'),0)::text AS "commissionPaise",
       COALESCE(SUM(amount_paise) FILTER(WHERE entry_type='ADJUSTMENT'),0)::text AS "adjustmentPaise",
       COALESCE(SUM(amount_paise) FILTER(WHERE entry_type IN ('EARNING','COMMISSION','ADJUSTMENT')),0)::text AS "netPaise",
       date_trunc('day',created_at) AS day
       FROM provider_wallet_entries WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '90 days'
       GROUP BY day ORDER BY day DESC`,
      [userId],
    );
    const periods = await this.pool.query(
      `SELECT periods.period,COALESCE(SUM(e.amount_paise) FILTER(WHERE e.entry_type='EARNING'),0)::text AS "grossPaise",
       COALESCE(-SUM(e.amount_paise) FILTER(WHERE e.entry_type='COMMISSION'),0)::text AS "commissionPaise",
       COALESCE(SUM(e.amount_paise) FILTER(WHERE e.entry_type='ADJUSTMENT'),0)::text AS "adjustmentPaise",
       COALESCE(SUM(e.amount_paise) FILTER(WHERE e.entry_type IN ('EARNING','COMMISSION','ADJUSTMENT')),0)::text AS "netPaise"
       FROM (VALUES('daily',date_trunc('day',NOW())),('weekly',date_trunc('week',NOW())),('monthly',date_trunc('month',NOW()))) AS periods(period,since)
       LEFT JOIN provider_wallet_entries e ON e.user_id=$1 AND e.created_at>=periods.since GROUP BY periods.period`,
      [userId],
    );
    const performance = await this.pool.query(
      `SELECT r.assigned_driver_id AS "driverProfileId",r.assigned_vehicle_id AS "vehicleId",COUNT(*)::int AS "completedCount",
       COALESCE(SUM(r.actual_distance_meters),0)::text AS "distanceMeters",COALESCE(SUM(r.final_fare),0)::text AS "grossRevenue"
       FROM rides r LEFT JOIN vehicles v ON v.id=r.assigned_vehicle_id
       WHERE r.status='completed' AND (v.owner_id=$1 OR r.assigned_driver_id IN(SELECT id FROM driver_profiles WHERE user_id=$1))
       GROUP BY r.assigned_driver_id,r.assigned_vehicle_id ORDER BY r.assigned_driver_id,r.assigned_vehicle_id LIMIT 1000`,
      [userId],
    );
    return {
      currency: 'INR',
      timeZone: 'UTC',
      days: result.rows,
      periods: periods.rows,
      performance: performance.rows,
    };
  }
}
