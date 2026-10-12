/** The queue FK is users.id. Business records supplement that identity, not its role. */
import { accountDisplayNameSql } from '../../users/repositories/account-identity.js';
export const approvalIdentityFields = `
  ${accountDisplayNameSql} AS requester_display_name,
  COALESCE(u.role::text, r.requester_role) AS requester_account_role,
  CASE r.target_type
    WHEN 'driver_profile' THEN 'Driver Profile'
    WHEN 'partner' THEN COALESCE(NULLIF(btrim(target_partner.business_name), ''), 'Partner Profile')
    WHEN 'vehicle' THEN COALESCE(NULLIF(btrim(v.plate_number), ''), 'Vehicle')
    WHEN 'driver_document' THEN COALESCE(NULLIF(dd.document_metadata->>'documentCode',''),dd.document_type::text)
    WHEN 'partner_document' THEN COALESCE(NULLIF(pd.metadata->>'documentCode',''),pd.document_type::text)
    ELSE NULL
  END AS target_description`;

// users.id and partners.user_id are unique: joins never multiply a request.
export const approvalIdentityJoins = `
  LEFT JOIN users u ON u.id = r.requester_id
  LEFT JOIN partners owner ON owner.user_id = u.id
  LEFT JOIN partners target_partner ON r.target_type = 'partner' AND target_partner.id = r.target_id
  LEFT JOIN vehicles v ON r.target_type = 'vehicle' AND v.id = r.target_id
  LEFT JOIN driver_documents dd ON r.target_type = 'driver_document' AND dd.id = r.target_id
  LEFT JOIN partner_documents pd ON r.target_type = 'partner_document' AND pd.id = r.target_id
  LEFT JOIN driver_profiles target_driver ON r.target_type IN ('driver_profile','driver_document')
    AND target_driver.id = CASE WHEN r.target_type = 'driver_document' THEN dd.driver_profile_id ELSE r.target_id END
  LEFT JOIN partners document_partner ON r.target_type = 'partner_document' AND document_partner.id = pd.partner_id`;

export function approvalReviewPermission(actor: '$2' | '$3') {
  return `(r.status='PENDING' AND r.requester_id<>${actor}::uuid AND
    (CASE r.target_type WHEN 'driver_profile' THEN target_driver.user_id
      WHEN 'driver_document' THEN target_driver.user_id WHEN 'partner' THEN target_partner.user_id
      WHEN 'partner_document' THEN document_partner.user_id WHEN 'vehicle' THEN v.owner_id END)
      IS DISTINCT FROM ${actor}::uuid) AS can_review`;
}
