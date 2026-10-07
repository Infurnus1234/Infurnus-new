BEGIN;
-- Evaluate only operator-configured rules. Empty configuration imposes no
-- artificial Aadhaar/PAN/permit/fitness requirement.
CREATE FUNCTION provider_compliance_satisfied(owner_uuid UUID,profile_uuid UUID,fleet_uuid UUID,vehicle_uuid UUID,category_code TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM provider_document_requirements r JOIN users u ON u.id=owner_uuid
  WHERE r.active AND r.required AND r.provider_role=u.role::text AND r.vehicle_category IN ('*',COALESCE(category_code,'*'))
  AND NOT (
   (profile_uuid IS NOT NULL AND EXISTS (
    SELECT 1 FROM driver_documents d WHERE d.driver_profile_id=profile_uuid AND d.verification_status='approved'
    AND COALESCE(d.document_metadata->>'documentCode',d.document_type::text)=r.document_code
    AND (NOT r.requires_expiry OR d.document_metadata->>'expiresAt' IS NOT NULL)
    AND (d.document_metadata->>'expiresAt' IS NULL OR (d.document_metadata->>'expiresAt')::date>=CURRENT_DATE)
    AND GREATEST(1,(SELECT count(*) FROM driver_document_pages pg WHERE pg.document_id=d.id AND pg.version=d.version))>=r.minimum_pages))
   OR (fleet_uuid IS NOT NULL AND EXISTS (
    SELECT 1 FROM partner_documents d WHERE d.partner_id=fleet_uuid AND d.status='VERIFIED'
    AND (d.vehicle_id IS NULL OR d.vehicle_id=vehicle_uuid)
    AND COALESCE(d.metadata->>'documentCode',lower(d.document_type::text))=r.document_code
    AND (NOT r.requires_expiry OR d.expires_at IS NOT NULL) AND (d.expires_at IS NULL OR d.expires_at>=CURRENT_DATE)
    AND GREATEST(1,CASE WHEN jsonb_typeof(d.metadata->'pages')='array' THEN jsonb_array_length(d.metadata->'pages') ELSE 0 END)>=r.minimum_pages))
  )
 );
$$;

CREATE FUNCTION protect_busy_provider_vehicle() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.driver_profile_id IS NOT NULL AND (NEW.driver_profile_id IS DISTINCT FROM OLD.driver_profile_id OR (OLD.is_active AND NOT NEW.is_active))
  AND EXISTS(SELECT 1 FROM driver_profiles WHERE id=OLD.driver_profile_id AND availability_status='busy') THEN
  RAISE EXCEPTION 'Busy vehicle cannot be deactivated or unassigned' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER provider_busy_vehicle_guard BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION protect_busy_provider_vehicle();
COMMIT;
