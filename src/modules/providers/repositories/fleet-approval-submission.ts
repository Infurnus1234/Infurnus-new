import type { Pool } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';

/** Submit owned drafts together; review and operational eligibility remain unchanged. */
export async function submitFleetApprovals(pool: Pool, userId: string, role: string) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const actor = await c.query(
      `SELECT id FROM users WHERE id=$1 AND role::text=$2
       AND role IN ('fleet_owner','driver_fleet_owner') AND status='active'
       AND deleted_at IS NULL FOR UPDATE`,
      [userId, role],
    );
    if (!actor.rowCount) throw new AppError('FORBIDDEN', 'Active Fleet Owner required', 403);
    const partner = (await c.query('SELECT id FROM partners WHERE user_id=$1 FOR SHARE', [userId]))
      .rows[0];
    if (!partner)
      throw new AppError(
        'BUSINESS_PROFILE_REQUIRED',
        'Save your Fleet business details before submitting requests',
        409,
      );
    const profiles = (
      await c.query(
        `SELECT dp.id,dp.user_id,dp.verification_status,dp.license_number,dp.license_expiry
       FROM driver_profiles dp JOIN users u ON u.id=dp.user_id
       WHERE u.status='active' AND u.deleted_at IS NULL AND (dp.user_id=$1 OR EXISTS(
         SELECT 1 FROM fleet_managed_driver_accounts m WHERE m.driver_user_id=dp.user_id
          AND m.partner_id=$2 AND m.status='ACTIVE')) ORDER BY dp.id FOR SHARE OF dp`,
        [userId, partner.id],
      )
    ).rows;
    const documents = (
      await c.query(
        `SELECT id,driver_profile_id,verification_status,storage_key,document_type,document_metadata
       FROM driver_documents WHERE driver_profile_id=ANY($1::uuid[]) ORDER BY id FOR SHARE`,
        [profiles.map((p) => p.id)],
      )
    ).rows;
    const targets: { type: string; id: string; owner: string; request: string }[] = [];
    const skipped: { targetType: string; targetId: string; reason: string }[] = [];
    for (const p of profiles) {
      if (!['pending', 'under_review'].includes(p.verification_status)) continue;
      const licence = documents.find(
        (d) =>
          d.driver_profile_id === p.id &&
          d.document_type === 'driver_license' &&
          !['rejected', 'expired', 'changes_requested'].includes(d.verification_status) &&
          d.storage_key,
      );
      if (
        !p.license_number?.trim() ||
        !p.license_expiry ||
        new Date(p.license_expiry).toISOString().slice(0, 10) <
          new Date().toISOString().slice(0, 10) ||
        !licence
      ) {
        skipped.push({
          targetType: 'driver_profile',
          targetId: p.id,
          reason: 'Save valid licence details and upload the licence before submitting this Driver',
        });
        continue;
      }
      targets.push({
        type: 'driver_profile',
        id: p.id,
        owner: p.user_id,
        request: 'driver_verification',
      });
    }
    for (const d of documents) {
      if (!['pending', 'under_review'].includes(d.verification_status) || !d.storage_key) continue;
      const expiry = d.document_metadata?.expiresAt;
      if (
        expiry &&
        (!Number.isFinite(Date.parse(expiry)) ||
          Date.parse(expiry) < Date.parse(new Date().toISOString().slice(0, 10)))
      )
        continue;
      targets.push({
        type: 'driver_document',
        id: d.id,
        owner: profiles.find((p) => p.id === d.driver_profile_id)!.user_id,
        request: 'document_reverification',
      });
    }
    const owned = (
      await c.query(
        `SELECT 'partner' AS type,id,'fleet_verification' AS request FROM partners
        WHERE id=$2 AND approval_status::text IN ('pending','under_review')
       UNION ALL SELECT 'vehicle',id,'vehicle_verification' FROM vehicles
        WHERE owner_id=$1 AND verification_status::text IN ('pending','under_review')
       UNION ALL SELECT 'partner_document',d.id,'document_reverification' FROM partner_documents d
        LEFT JOIN vehicles v ON v.id=d.vehicle_id WHERE d.partner_id=$2
        AND (d.vehicle_id IS NULL OR v.owner_id=$1) AND d.status::text IN ('PENDING','SUBMITTED')
        AND d.metadata->'storage'->>'storageKey' IS NOT NULL
        AND (d.expires_at IS NULL OR d.expires_at>=CURRENT_DATE)
       UNION ALL SELECT 'bank_account',id,'bank_verification' FROM provider_bank_accounts
        WHERE user_id=$1 AND NOT is_verified`,
        [userId, partner.id],
      )
    ).rows;
    targets.push(...owned.map((t) => ({ ...t, owner: userId })));
    targets.sort((a, b) => a.id.localeCompare(b.id));
    const requests: Record<string, unknown>[] = [];
    for (const t of targets) {
      // Reuse domain-trigger reviews across request types; never claim another Fleet's review.
      const existing = await c.query(
        `UPDATE provider_approval_requests SET requester_id=$1,requester_role=$2,fleet_id=$3
         WHERE target_type=$4 AND target_id=$5 AND status='PENDING'
           AND (fleet_id IS NULL OR fleet_id=$3) AND requester_id IN ($1,$6)
         RETURNING id,status,target_type,target_id`,
        [userId, role, partner.id, t.type, t.id, t.owner],
      );
      if (existing.rowCount) {
        requests.push(...existing.rows);
        continue;
      }
      const other = await c.query(
        "SELECT 1 FROM provider_approval_requests WHERE target_type=$1 AND target_id=$2 AND status='PENDING'",
        [t.type, t.id],
      );
      if (other.rowCount) {
        skipped.push({
          targetType: t.type,
          targetId: t.id,
          reason: 'Another submitter already has a pending review for this target',
        });
        continue;
      }
      const inserted = await c.query(
        `INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id,metadata)
         VALUES($1,$2,$3,$4,$5,$6,'{"batchSubmission":true}') ON CONFLICT DO NOTHING
         RETURNING id,status,target_type,target_id`,
        [userId, role, partner.id, t.request, t.type, t.id],
      );
      requests.push(...inserted.rows);
    }
    await c.query('COMMIT');
    return {
      requests,
      skipped,
      message:
        'Eligible requests submitted together. Each request requires an independent Admin decision.',
    };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
