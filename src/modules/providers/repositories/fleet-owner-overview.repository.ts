import type { Pool } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import { PostgresProviderBankRepository } from './provider-bank.repository.js';

export type FleetOwnerSection =
  'profile' | 'documents' | 'bank' | 'vehicles' | 'drivers' | 'activity';
export class FleetOwnerOverviewRepository {
  constructor(private readonly pool: Pool) {}
  async read(
    actor: string,
    partnerId: string,
    section: FleetOwnerSection,
    limit: number,
    offset: number,
    search: string,
    status: string,
  ) {
    // This consolidated workspace includes financial/identity data. Ordinary
    // operational administrators retain their existing narrower review screens.
    const reviewer = (
      await this.pool.query(
        "SELECT id FROM users WHERE id=$1 AND role='super_admin' AND status='active' AND deleted_at IS NULL",
        [actor],
      )
    ).rows[0];
    if (!reviewer)
      throw new AppError(
        'FORBIDDEN',
        'Sensitive fleet-owner workspace requires an active Super Admin',
        403,
      );
    const owner = (
      await this.pool.query(
        `SELECT p.id,p.user_id AS "userId",p.business_name AS "businessName",p.approval_status AS "approvalStatus",(SELECT CASE WHEN count(*)=0 THEN 'NOT_SUBMITTED' WHEN bool_or(d.expires_at<CURRENT_DATE OR d.status='EXPIRED') THEN 'EXPIRED' WHEN bool_or(d.status='REJECTED') THEN 'REJECTED' WHEN bool_and(d.status='VERIFIED') THEN 'VERIFIED' ELSE 'PENDING' END FROM partner_documents d WHERE d.partner_id=p.id AND d.vehicle_id IS NULL AND d.document_type IN ('AADHAAR','PAN','DRIVING_LICENCE')) AS "identityReviewStatus",
      (SELECT count(*)::int FROM partner_documents d WHERE d.partner_id=p.id AND (d.status IN ('PENDING','REJECTED','EXPIRED') OR d.expires_at<CURRENT_DATE)) AS "actionRequiredDocuments",
      (SELECT count(*)::int FROM partner_documents d WHERE d.partner_id=p.id AND d.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE+30) AS "expiringSoonDocuments",u.first_name AS "firstName",u.last_name AS "lastName",u.email,u.phone,u.role
      FROM partners p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND u.deleted_at IS NULL`,
        [partnerId],
      )
    ).rows[0];
    if (!owner) throw new AppError('PARTNER_NOT_FOUND', 'Fleet Owner not found', 404);
    if (section === 'profile') return { owner, section, items: [], hasNext: false };
    if (section === 'bank') {
      const bank = await new PostgresProviderBankRepository(this.pool).getBankAccount(owner.userId);
      const history = (
        await this.pool.query(
          'SELECT id,actor_id,action,snapshot,created_at FROM provider_bank_change_history WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
          [owner.userId, limit + 1, offset],
        )
      ).rows;
      return {
        owner,
        section,
        bank,
        items: history.slice(0, limit),
        hasNext: history.length > limit,
      };
    }
    const values: unknown[] = [partnerId, limit + 1, offset, '%' + search + '%', status];
    let sql: string;
    if (section === 'documents')
      sql = `SELECT d.id,d.document_type AS "documentType",d.vehicle_id AS "vehicleId",d.version,d.uploaded_at AS "uploadedAt",d.reviewed_by AS "reviewedBy",d.reviewed_at AS "reviewedAt",d.expires_at AS "expiresAt",(d.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE+30) AS "expiringSoon",
      CASE WHEN d.expires_at<CURRENT_DATE THEN 'EXPIRED' ELSE d.status::text END AS status,
      d.metadata->>'documentCode' AS "documentCode",d.metadata->>'holderName' AS "holderName",d.metadata->>'rejectionReason' AS "rejectionReason",
      (SELECT r.id FROM provider_approval_requests r WHERE r.target_type='partner_document' AND r.target_id=d.id ORDER BY r.submitted_at DESC,r.id DESC LIMIT 1) AS "approvalId"
      FROM partner_documents d WHERE d.partner_id=$1
      AND concat_ws(' ',d.document_type,d.metadata->>'documentCode') ILIKE $4
      AND ($5='ALL' OR ($5='ACTION_REQUIRED' AND (d.status IN ('PENDING','REJECTED','EXPIRED') OR d.expires_at<CURRENT_DATE)) OR (CASE WHEN d.expires_at<CURRENT_DATE THEN 'EXPIRED' ELSE d.status::text END)=$5)
      ORDER BY d.updated_at DESC,d.id DESC LIMIT $2 OFFSET $3`;
    else if (section === 'vehicles')
      sql = `SELECT v.id,v.plate_number AS "plateNumber",v.make,v.model,v.category,v.sector,v.is_active AS "isActive",v.verification_status AS status,
      (SELECT r.id FROM provider_approval_requests r WHERE r.target_type='vehicle' AND r.target_id=v.id ORDER BY r.submitted_at DESC,r.id DESC LIMIT 1) AS "approvalId"
      FROM vehicles v JOIN partners p ON p.user_id=v.owner_id WHERE p.id=$1 AND concat_ws(' ',v.plate_number,v.make,v.model) ILIKE $4 AND ($5='ALL' OR upper(v.verification_status::text)=$5 OR ($5='ACTION_REQUIRED' AND (v.verification_status::text<>'approved' OR NOT v.is_active)))
      ORDER BY v.updated_at DESC,v.id DESC LIMIT $2 OFFSET $3`;
    else if (section === 'drivers')
      sql = `SELECT dp.id,dp.user_id AS "userId",u.first_name AS "firstName",u.last_name AS "lastName",u.phone,u.email,dp.verification_status AS status,dp.license_expiry AS "licenseExpiry",dp.active_vehicle_id AS "vehicleId",
      EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m WHERE m.partner_id=$1 AND m.driver_user_id=u.id AND m.status='ACTIVE') AS "managementAuthorized"
      FROM driver_profiles dp JOIN users u ON u.id=dp.user_id WHERE u.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM partner_drivers pd WHERE pd.partner_id=$1 AND pd.driver_profile_id=dp.id) OR EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m WHERE m.partner_id=$1 AND m.driver_user_id=u.id))
      AND concat_ws(' ',u.first_name,u.last_name,u.phone) ILIKE $4 AND ($5='ALL' OR upper(dp.verification_status::text)=$5 OR ($5='ACTION_REQUIRED' AND (dp.verification_status::text<>'approved' OR dp.license_expiry<CURRENT_DATE)))
      ORDER BY dp.updated_at DESC,dp.id DESC LIMIT $2 OFFSET $3`;
    else
      sql = `SELECT r.id,r.target_type AS "targetType",r.target_id AS "targetId",r.request_type AS "requestType",r.status,r.submitted_at AS "submittedAt",r.reviewer_id AS "reviewerId",r.reviewed_at AS "reviewedAt",r.rejection_reason AS "rejectionReason"
      FROM provider_approval_requests r JOIN partners p ON p.user_id=r.requester_id WHERE p.id=$1 AND r.request_type ILIKE $4 AND ($5='ALL' OR r.status=$5 OR ($5='ACTION_REQUIRED' AND r.status IN ('PENDING','REJECTED','EXPIRED'))) ORDER BY r.submitted_at DESC,r.id DESC LIMIT $2 OFFSET $3`;
    const rows = (await this.pool.query(sql, values)).rows;
    return { owner, section, items: rows.slice(0, limit), hasNext: rows.length > limit };
  }
}
