import type { PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import { accountDisplayNameSql } from '../../users/repositories/account-identity.js';

// Group by the resource owner, not uploader/email text. A fleet can submit a
// driver's documents; that must never merge two drivers or another provider role.
export const onboardingProfileSql = `CASE WHEN r.target_type='driver_document' THEN dd.driver_profile_id
  WHEN r.target_type='driver_profile' AND r.request_type<>'driver_association' THEN r.target_id END`;
export const onboardingJoinsSql = `LEFT JOIN driver_documents dd ON r.target_type='driver_document' AND dd.id=r.target_id
  LEFT JOIN driver_profiles dp ON dp.id=(${onboardingProfileSql})`;

export async function onboardingProfile(client: PoolClient, requestId: string) {
  return (
    await client.query(
      `SELECT dp.id,dp.user_id FROM provider_approval_requests r ${onboardingJoinsSql} WHERE r.id=$1`,
      [requestId],
    )
  ).rows[0];
}

export async function onboardingItems(client: PoolClient, profileId: string) {
  return (
    await client.query(
      `SELECT r.id,r.requester_id,r.target_type,r.target_id,r.request_type,r.status,r.submitted_at,r.rejection_reason,
    COALESCE(dd.document_metadata->>'documentCode',dd.document_type::text,'Driver profile') AS label,
    CASE WHEN r.target_type='driver_profile' THEN to_jsonb(dp)->>'updated_at' ELSE to_jsonb(dd)->>'updated_at' END AS expected_updated_at
    FROM provider_approval_requests r ${onboardingJoinsSql}
    WHERE dp.id=$1 ORDER BY r.submitted_at DESC,r.id DESC`,
      [profileId],
    )
  ).rows;
}

export async function groupedApprovals(client: PoolClient, actorId: string, status: string) {
  return (
    await client.query(
      `WITH scoped AS (
    SELECT r.*,dp.id AS driver_profile_id,COALESCE(dp.user_id,r.requester_id) AS owner_id,
      CASE WHEN dp.id IS NOT NULL THEN 'driver:'||dp.id::text ELSE r.id::text END AS group_id
    FROM provider_approval_requests r ${onboardingJoinsSql}
    WHERE r.target_type<>'bank_account'
  ), ranked AS (
    SELECT s.*,row_number() OVER(PARTITION BY group_id ORDER BY (status='PENDING') DESC,
      (target_type='driver_profile') DESC,submitted_at DESC,id DESC) AS position,
      count(*) OVER(PARTITION BY group_id)::int AS item_count,min(submitted_at) OVER(PARTITION BY group_id) AS first_submitted_at,
      bool_or(status='PENDING') OVER(PARTITION BY group_id) AS has_pending
    FROM scoped s
  ), consolidated AS (
    SELECT r.*,CASE WHEN r.driver_profile_id IS NULL THEN r.status::text
      WHEN r.has_pending THEN 'PENDING'
      WHEN profile.verification_status='approved' AND NOT provider_compliance_satisfied(profile.user_id,profile.id,NULL,profile.active_vehicle_id,assigned.category)
        THEN CASE WHEN EXISTS(SELECT 1 FROM provider_document_requirements policy JOIN driver_documents doc
          ON doc.driver_profile_id=profile.id AND COALESCE(doc.document_metadata->>'documentCode',doc.document_type::text)=policy.document_code
          WHERE policy.provider_role=account.role::text AND policy.active AND policy.required
          AND policy.vehicle_category IN('*',COALESCE(assigned.category,'*')) AND doc.verification_status='rejected')
          THEN 'REJECTED' ELSE 'PENDING' END
      ELSE upper(profile.verification_status::text) END AS onboarding_status
    FROM ranked r LEFT JOIN driver_profiles profile ON profile.id=r.driver_profile_id
    LEFT JOIN users account ON account.id=profile.user_id
    LEFT JOIN vehicles assigned ON assigned.id=profile.active_vehicle_id WHERE r.position=1
  ) SELECT r.id,r.owner_id AS requester_id,r.requester_role,u.role::text AS requester_account_role,
    ${accountDisplayNameSql} AS requester_display_name,
    CASE WHEN u.deleted_at IS NULL THEN u.email END AS requester_email,
    r.target_type,r.target_id,r.onboarding_status AS status,r.first_submitted_at AS submitted_at,r.item_count,r.driver_profile_id,
    CASE WHEN r.driver_profile_id IS NOT NULL THEN 'driver_onboarding' ELSE r.request_type END AS request_type,
    CASE WHEN r.driver_profile_id IS NOT NULL THEN 'Driver onboarding'
      WHEN r.target_type='partner' THEN COALESCE(NULLIF(btrim(p.business_name),''),'Partner Profile')
      WHEN r.target_type='vehicle' THEN COALESCE(NULLIF(btrim(v.plate_number),''),'Vehicle')
      WHEN r.target_type='partner_document' THEN COALESCE(pd.metadata->>'documentCode',pd.document_type::text)
      ELSE replace(r.target_type,'_',' ') END AS target_description,
    (r.status='PENDING' AND r.owner_id<>$2::uuid AND r.requester_id<>$2::uuid) AS can_review
    FROM consolidated r LEFT JOIN users u ON u.id=r.owner_id
    LEFT JOIN partners owner ON owner.user_id=u.id
    LEFT JOIN partners p ON r.target_type='partner' AND p.id=r.target_id
    LEFT JOIN vehicles v ON r.target_type='vehicle' AND v.id=r.target_id
    LEFT JOIN partner_documents pd ON r.target_type='partner_document' AND pd.id=r.target_id
    WHERE ($1='ALL' OR r.onboarding_status=$1)
    ORDER BY CASE WHEN $1='PENDING' THEN r.first_submitted_at END ASC,r.first_submitted_at DESC,r.id LIMIT 100`,
      [status, actorId],
    )
  ).rows;
}

export function changedOnboarding(): never {
  throw new AppError(
    'TARGET_CHANGED',
    'Onboarding changed; reload all documents before reviewing',
    409,
  );
}
