BEGIN;

-- Association applications and partner review history already exist. This
-- queue unifies the missing document/profile/vehicle/bank approval handoff;
-- it does not replace those authoritative domain states or their reviewers.
CREATE TABLE provider_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requester_role VARCHAR(30) NOT NULL,
  fleet_id UUID REFERENCES partners(id) ON DELETE RESTRICT,
  request_type VARCHAR(50) NOT NULL CHECK (length(trim(request_type)) > 0),
  target_type VARCHAR(40) NOT NULL CHECK (target_type IN ('driver_profile','driver_document','partner','partner_document','vehicle','bank_account')),
  target_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_role VARCHAR(30),
  rejection_reason TEXT,
  requested_changes JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  previous_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reviewer_id IS NULL OR reviewer_id <> requester_id),
  CHECK (status NOT IN ('APPROVED','REJECTED') OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_role IN ('admin','super_admin'))),
  CHECK (status <> 'REJECTED' OR length(trim(rejection_reason)) > 0)
);
CREATE UNIQUE INDEX provider_approval_pending_target_uidx ON provider_approval_requests(target_type,target_id,request_type) WHERE status='PENDING';
CREATE INDEX provider_approval_owner_time_idx ON provider_approval_requests(requester_id,created_at DESC);
CREATE INDEX provider_approval_fleet_status_idx ON provider_approval_requests(fleet_id,status,submitted_at);
CREATE INDEX provider_approval_pending_idx ON provider_approval_requests(submitted_at) WHERE status='PENDING';

CREATE FUNCTION enqueue_provider_approval() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_uuid UUID; fleet_uuid UUID; owner_role TEXT; target_kind TEXT; request_kind TEXT; domain_state TEXT; previous_json JSONB;
BEGIN
  IF TG_OP='UPDATE' THEN previous_json := jsonb_build_object('updatedAt',OLD.updated_at); END IF;
  CASE TG_TABLE_NAME
    WHEN 'driver_profiles' THEN owner_uuid := NEW.user_id; target_kind := 'driver_profile'; request_kind := 'driver_verification'; domain_state := NEW.verification_status::text;
    WHEN 'driver_documents' THEN SELECT user_id INTO owner_uuid FROM driver_profiles WHERE id=NEW.driver_profile_id; target_kind := 'driver_document'; request_kind := NEW.document_type::text; domain_state := NEW.verification_status::text;
    WHEN 'partners' THEN owner_uuid := NEW.user_id; fleet_uuid := NEW.id; target_kind := 'partner'; request_kind := 'fleet_verification'; domain_state := NEW.approval_status::text;
    WHEN 'partner_documents' THEN SELECT user_id INTO owner_uuid FROM partners WHERE id=NEW.partner_id; fleet_uuid := NEW.partner_id; target_kind := 'partner_document'; request_kind := NEW.document_type::text; domain_state := NEW.status::text;
    WHEN 'vehicles' THEN owner_uuid := NEW.owner_id; target_kind := 'vehicle'; request_kind := 'vehicle_verification'; domain_state := NEW.verification_status::text;
    WHEN 'provider_bank_accounts' THEN owner_uuid := NEW.user_id; target_kind := 'bank_account'; request_kind := 'bank_verification'; domain_state := CASE WHEN NEW.is_verified THEN 'approved' ELSE 'pending' END;
  END CASE;
  IF owner_uuid IS NULL OR lower(domain_state) NOT IN ('pending','under_review','submitted') THEN RETURN NEW; END IF;
  SELECT role::text INTO owner_role FROM users WHERE id=owner_uuid;
  IF owner_role NOT IN ('driver','fleet_owner','driver_fleet_owner') THEN RETURN NEW; END IF;
  IF fleet_uuid IS NULL THEN SELECT id INTO fleet_uuid FROM partners WHERE user_id=owner_uuid; END IF;
  INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id,previous_state)
  VALUES(owner_uuid,owner_role,fleet_uuid,request_kind,target_kind,NEW.id,previous_json)
  ON CONFLICT (target_type,target_id,request_type) WHERE status='PENDING'
  DO UPDATE SET submitted_at=NOW(),updated_at=NOW(),previous_state=EXCLUDED.previous_state;
  RETURN NEW;
END;
$$;

CREATE TRIGGER driver_profile_approval_handoff AFTER INSERT OR UPDATE OF license_number,license_expiry,verification_status ON driver_profiles FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();
CREATE TRIGGER driver_document_approval_handoff AFTER INSERT OR UPDATE OF storage_key,verification_status ON driver_documents FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();
CREATE TRIGGER partner_approval_handoff AFTER INSERT OR UPDATE OF business_name,approval_status ON partners FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();
CREATE TRIGGER partner_document_approval_handoff AFTER INSERT OR UPDATE OF metadata,status ON partner_documents FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();
CREATE TRIGGER vehicle_approval_handoff AFTER INSERT OR UPDATE OF verification_status ON vehicles FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();
CREATE TRIGGER bank_approval_handoff AFTER INSERT OR UPDATE OF account_number_encrypted ON provider_bank_accounts FOR EACH ROW EXECUTE FUNCTION enqueue_provider_approval();

-- Queue pre-existing pending resources without altering approval state.
INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id)
SELECT u.id,u.role::text,p.id,'fleet_verification','partner',p.id FROM partners p JOIN users u ON u.id=p.user_id
WHERE p.approval_status IN ('pending','under_review') AND u.role::text IN ('driver','fleet_owner','driver_fleet_owner');
INSERT INTO provider_approval_requests(requester_id,requester_role,request_type,target_type,target_id)
SELECT u.id,u.role::text,'driver_verification','driver_profile',dp.id FROM driver_profiles dp JOIN users u ON u.id=dp.user_id
WHERE dp.verification_status IN ('pending','under_review') AND u.role::text IN ('driver','driver_fleet_owner');
INSERT INTO provider_approval_requests(requester_id,requester_role,request_type,target_type,target_id)
SELECT u.id,u.role::text,d.document_type::text,'driver_document',d.id FROM driver_documents d JOIN driver_profiles dp ON dp.id=d.driver_profile_id JOIN users u ON u.id=dp.user_id
WHERE d.verification_status='pending' AND u.role::text IN ('driver','driver_fleet_owner');
INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id)
SELECT u.id,u.role::text,p.id,d.document_type::text,'partner_document',d.id FROM partner_documents d JOIN partners p ON p.id=d.partner_id JOIN users u ON u.id=p.user_id
WHERE d.status IN ('PENDING','SUBMITTED') AND u.role::text IN ('driver','fleet_owner','driver_fleet_owner');
INSERT INTO provider_approval_requests(requester_id,requester_role,fleet_id,request_type,target_type,target_id)
SELECT u.id,u.role::text,p.id,'vehicle_verification','vehicle',v.id FROM vehicles v JOIN users u ON u.id=v.owner_id LEFT JOIN partners p ON p.user_id=u.id
WHERE v.verification_status='pending' AND u.role::text IN ('driver','fleet_owner','driver_fleet_owner');

COMMIT;
