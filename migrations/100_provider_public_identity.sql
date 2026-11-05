-- Public identities are additive. All existing resource and authentication UUIDs remain intact.
CREATE TABLE provider_id_allocator (
 namespace TEXT PRIMARY KEY CHECK(namespace='provider_account'),
 id_length INTEGER NOT NULL CHECK(id_length BETWEEN 6 AND 64),
 last_value NUMERIC NOT NULL CHECK(last_value>=100000 AND last_value=trunc(last_value)),
 version BIGINT NOT NULL DEFAULT 1,
 allocations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(last_value < power(10::numeric,id_length))
);
INSERT INTO provider_id_allocator(namespace,id_length,last_value) VALUES('provider_account',6,100000);

CREATE TABLE provider_identities (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 public_id TEXT NOT NULL UNIQUE CHECK(public_id ~ '^[1-9][0-9]{5,63}$'),
 issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 source TEXT NOT NULL CHECK(source IN ('registration','backfill','verified_link')),
 batch_id TEXT,
 tombstoned_at TIMESTAMPTZ
);
CREATE TABLE provider_identity_accounts (
 -- account_id is the retained historical UUID, even after physical account removal.
 account_id UUID PRIMARY KEY,
 user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
 identity_id UUID NOT NULL REFERENCES provider_identities(id) ON DELETE RESTRICT,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 evidence TEXT NOT NULL,
 CHECK(user_id IS NULL OR user_id=account_id)
);
CREATE INDEX provider_identity_accounts_identity_idx ON provider_identity_accounts(identity_id);
CREATE TABLE provider_identity_audit (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event TEXT NOT NULL,
 identity_id UUID REFERENCES provider_identities(id),
 account_id UUID,
 actor_id UUID,
 details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE provider_identity_reconciliation (
 account_id UUID PRIMARY KEY,
 reason TEXT NOT NULL,
 batch_id TEXT NOT NULL,
 reviewed_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION protect_provider_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued provider identities and audit records cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='provider_identities' THEN
  IF (NEW.id IS DISTINCT FROM OLD.id OR NEW.public_id IS DISTINCT FROM OLD.public_id OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.source IS DISTINCT FROM OLD.source OR NEW.batch_id IS DISTINCT FROM OLD.batch_id) THEN
  RAISE EXCEPTION 'Issued provider identity is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='provider_identity_accounts' THEN
  IF (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.identity_id IS DISTINCT FROM OLD.identity_id OR NEW.evidence IS DISTINCT FROM OLD.evidence OR NEW.linked_at IS DISTINCT FROM OLD.linked_at) THEN
  RAISE EXCEPTION 'Provider identity membership is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='provider_identity_audit' THEN RAISE EXCEPTION 'Identity audit is append only' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_identity_immutable BEFORE UPDATE OR DELETE ON provider_identities FOR EACH ROW EXECUTE FUNCTION protect_provider_identity();
CREATE TRIGGER provider_membership_immutable BEFORE UPDATE OR DELETE ON provider_identity_accounts FOR EACH ROW EXECUTE FUNCTION protect_provider_identity();
CREATE TRIGGER provider_identity_audit_immutable BEFORE UPDATE OR DELETE ON provider_identity_audit FOR EACH ROW EXECUTE FUNCTION protect_provider_identity();

CREATE FUNCTION provider_public_id(account UUID) RETURNS TEXT LANGUAGE sql STABLE AS $$
 SELECT i.public_id FROM provider_identity_accounts a JOIN provider_identities i ON i.id=a.identity_id WHERE a.user_id=account
$$;

CREATE FUNCTION guard_provider_membership() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role IN ('driver','fleet_owner','driver_fleet_owner')) THEN
  RAISE EXCEPTION 'Only provider accounts may have provider identities' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_membership_role BEFORE INSERT OR UPDATE ON provider_identity_accounts FOR EACH ROW EXECUTE FUNCTION guard_provider_membership();

-- Caller must use the account-creation transaction. The global row serializes allocation,
-- candidate checks, and configuration activation across all backend instances.
CREATE FUNCTION ensure_provider_identity(account UUID, origin TEXT DEFAULT 'registration', batch TEXT DEFAULT NULL, verified_accounts UUID[] DEFAULT '{}') RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE u users%ROWTYPE; found_id TEXT; state provider_id_allocator%ROWTYPE; candidate NUMERIC; identity UUID;
BEGIN
 SELECT * INTO u FROM users WHERE id=account FOR UPDATE;
 IF NOT FOUND OR u.role NOT IN ('driver','fleet_owner','driver_fleet_owner') THEN
  RAISE EXCEPTION 'Eligible provider account required' USING ERRCODE='23514';
 END IF;
 SELECT i.public_id INTO found_id FROM provider_identity_accounts a JOIN provider_identities i ON i.id=a.identity_id WHERE a.account_id=account;
 IF found_id IS NOT NULL THEN
  UPDATE provider_identity_accounts SET user_id=account WHERE account_id=account AND user_id IS NULL;
  RETURN found_id;
 END IF;
 SELECT * INTO STRICT state FROM provider_id_allocator WHERE namespace='provider_account' FOR UPDATE;
 IF NOT state.allocations_enabled THEN RAISE EXCEPTION 'PROVIDER_ID_ALLOCATION_PAUSED: provider registration is temporarily paused' USING ERRCODE='P1003'; END IF;
 -- Contacts are a conflict signal, never sufficient ownership evidence for a merge.
 IF EXISTS(SELECT 1 FROM users other WHERE other.id<>account AND NOT (other.id=ANY(verified_accounts)) AND other.role IN ('driver','fleet_owner','driver_fleet_owner') AND
   ((u.email IS NOT NULL AND lower(btrim(other.email))=lower(btrim(u.email))) OR
    (u.phone IS NOT NULL AND ltrim(btrim(other.phone),'+')=ltrim(btrim(u.phone),'+')))) THEN
  RAISE EXCEPTION 'PROVIDER_IDENTITY_RECONCILIATION_REQUIRED: sign in to the existing provider account or verify both accounts' USING ERRCODE='P1001';
 END IF;
 candidate:=greatest(state.last_value+1,power(10::numeric,state.id_length-1));
 IF candidate>=power(10::numeric,state.id_length) THEN
  RAISE EXCEPTION 'PROVIDER_ID_CAPACITY_EXHAUSTED: activate a larger ID length' USING ERRCODE='P1002';
 END IF;
 INSERT INTO provider_identities(public_id,source,batch_id) VALUES(trunc(candidate)::text,origin,batch) RETURNING id INTO identity;
 INSERT INTO provider_identity_accounts(account_id,user_id,identity_id,evidence) VALUES(account,account,identity,origin);
 UPDATE provider_id_allocator SET last_value=candidate,updated_at=clock_timestamp() WHERE namespace='provider_account';
 INSERT INTO provider_identity_audit(event,identity_id,account_id,details) VALUES('issued',identity,account,jsonb_build_object('source',origin,'batchId',batch));
 RETURN trunc(candidate)::text;
END $$;

CREATE FUNCTION provider_account_identity_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.role IN ('driver','fleet_owner','driver_fleet_owner') THEN
  PERFORM ensure_provider_identity(NEW.id);
 ELSIF EXISTS(SELECT 1 FROM provider_identity_accounts WHERE account_id=NEW.id) THEN
  -- Archive the former provider membership when existing account-management code
  -- changes the auth role. Never expose a provider public ID to an excluded role.
  UPDATE provider_identity_accounts SET user_id=NULL WHERE account_id=NEW.id;
  UPDATE provider_identities i SET tombstoned_at=COALESCE(i.tombstoned_at,clock_timestamp())
    FROM provider_identity_accounts a WHERE a.account_id=NEW.id AND i.id=a.identity_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER users_provider_identity AFTER INSERT OR UPDATE OF role ON users FOR EACH ROW EXECUTE FUNCTION provider_account_identity_trigger();

CREATE FUNCTION partner_owner_public_identity_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ensure_provider_identity(NEW.user_id);
 RETURN NEW;
END $$;
CREATE TRIGGER partners_provider_identity BEFORE INSERT OR UPDATE OF user_id ON partners FOR EACH ROW EXECUTE FUNCTION partner_owner_public_identity_trigger();

CREATE FUNCTION tombstone_provider_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.deleted_at IS NOT NULL THEN
  UPDATE provider_identities i SET tombstoned_at=COALESCE(i.tombstoned_at,clock_timestamp()) FROM provider_identity_accounts a WHERE a.account_id=OLD.id AND i.id=a.identity_id;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER users_provider_identity_deleted AFTER DELETE OR UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION tombstone_provider_identity();

CREATE FUNCTION guard_provider_allocator() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Provider allocator cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.namespace<>OLD.namespace OR NEW.last_value<OLD.last_value OR NEW.id_length<OLD.id_length THEN
  RAISE EXCEPTION 'Provider allocator cannot move backwards' USING ERRCODE='23514';
 END IF;
 IF NEW.id_length<>OLD.id_length THEN
  NEW.version:=OLD.version+1;
  INSERT INTO provider_identity_audit(event,actor_id,details) VALUES('length_activated',NULLIF(current_setting('infurnus.actor_id',true),'')::uuid,jsonb_build_object('before',OLD.id_length,'after',NEW.id_length,'version',NEW.version));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_allocator_monotonic BEFORE UPDATE OR DELETE ON provider_id_allocator FOR EACH ROW EXECUTE FUNCTION guard_provider_allocator();
CREATE FUNCTION activate_provider_id_length(width INTEGER, actor UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE current_width INTEGER;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='super_admin' AND status='active' AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Active Super Admin required' USING ERRCODE='42501';
 END IF;
 SELECT id_length INTO STRICT current_width FROM provider_id_allocator WHERE namespace='provider_account' FOR UPDATE;
 IF width IS NULL OR width<=current_width OR width>64 THEN RAISE EXCEPTION 'ID length must increase and be at most 64' USING ERRCODE='22023'; END IF;
 PERFORM set_config('infurnus.actor_id',actor::text,true);
 UPDATE provider_id_allocator SET id_length=width,updated_at=clock_timestamp() WHERE namespace='provider_account';
END $$;
CREATE VIEW provider_id_capacity AS SELECT id_length,version,allocations_enabled,trunc(last_value)::text AS last_value,
 trunc(power(10::numeric,id_length)-1-last_value)::text AS remaining,
 (last_value>=power(10::numeric,id_length)-1) AS exhausted FROM provider_id_allocator;

CREATE FUNCTION pause_provider_id_allocation(paused BOOLEAN, actor UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='super_admin' AND status='active' AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Active Super Admin required' USING ERRCODE='42501';
 END IF;
 UPDATE provider_id_allocator SET allocations_enabled=NOT paused,updated_at=clock_timestamp() WHERE namespace='provider_account';
 INSERT INTO provider_identity_audit(event,actor_id,details) VALUES('allocation_pause',actor,jsonb_build_object('paused',paused));
END $$;

-- Existing accounts are deliberately backfilled by the resumable, reviewed migration tool.
-- Ambiguous contacts are queued there rather than silently merged by this DDL.
