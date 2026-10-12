/** Shared display identity. Callers join users as u and its unique business as owner. */
export const accountDisplayNameSql = `CASE WHEN u.deleted_at IS NOT NULL THEN NULL
  WHEN u.role::text='fleet_owner' THEN
    COALESCE(NULLIF(btrim(owner.business_name),''),NULLIF(btrim(concat_ws(' ',u.first_name,u.last_name)),''))
  ELSE COALESCE(NULLIF(btrim(concat_ws(' ',u.first_name,u.last_name)),''),NULLIF(btrim(owner.business_name),'')) END`;
