-- No tariff seeds or historical payment backfill.
ALTER TABLE vehicle_types ADD COLUMN logistics_slabs JSONB;
CREATE FUNCTION logistics_slabs_valid(s JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE slab JSONB; val JSONB;
BEGIN
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['below_15','from_15']) OR (SELECT count(*) FROM jsonb_object_keys(s))<>2 THEN RETURN FALSE; END IF;
 FOR slab IN SELECT value FROM jsonb_each(s) LOOP
  IF jsonb_typeof(slab) IS DISTINCT FROM 'object' OR NOT(slab ?& ARRAY['baseFare','perKmRate']) OR (SELECT count(*) FROM jsonb_object_keys(slab))<>2 THEN RETURN FALSE; END IF;
  FOR val IN SELECT value FROM jsonb_each(slab) LOOP
   IF jsonb_typeof(val) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
   IF val::text::numeric<0 OR val::text::numeric>99999999.99 OR round(val::text::numeric,2)<>val::text::numeric THEN RETURN FALSE; END IF;
  END LOOP;
 END LOOP;
 RETURN TRUE;
END $$;
ALTER TABLE vehicle_types DROP CONSTRAINT vehicle_type_pricing_model_check;
ALTER TABLE vehicle_types ADD CONSTRAINT vehicle_type_pricing_model_check CHECK (
 (logistics_slabs IS NOT NULL AND sector='logistics' AND logistics_slabs_valid(logistics_slabs) AND base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND pricing_reference IS NULL AND hourly_base_fares_paise IS NULL) OR
 (logistics_slabs IS NULL AND ((base_fare_paise IS NOT NULL AND per_km_rate_paise IS NOT NULL AND code<>'ftl') OR
 (base_fare_paise IS NULL AND per_km_rate_paise IS NULL AND ((pricing_reference IS NOT NULL AND jsonb_typeof(pricing_reference)='object') OR (pricing_reference IS NULL AND active=FALSE)))))
);
CREATE TABLE logistics_ride_payment_plans (
 ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE, total_paise BIGINT NOT NULL CHECK(total_paise>0),
 upfront_paise BIGINT NOT NULL, final_paise BIGINT NOT NULL, currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(upfront_paise=round(total_paise*0.4) AND final_paise=total_paise-upfront_paise)
);
CREATE FUNCTION create_logistics_payment_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.sector='logistics' AND NEW.fare_estimate>0 THEN
 INSERT INTO logistics_ride_payment_plans(ride_id,total_paise,upfront_paise,final_paise)
 VALUES(NEW.id,round(NEW.fare_estimate*100),round(round(NEW.fare_estimate*100)*0.4),round(NEW.fare_estimate*100)-round(round(NEW.fare_estimate*100)*0.4));
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER logistics_payment_plan AFTER INSERT ON rides FOR EACH ROW EXECUTE FUNCTION create_logistics_payment_plan();
ALTER TABLE payments ADD COLUMN payment_stage TEXT CHECK(payment_stage IN ('upfront','final')),
 ADD COLUMN customer_claimed_at TIMESTAMPTZ, ADD COLUMN cash_confirmed_by UUID REFERENCES users(id), ADD COLUMN cash_confirmed_at TIMESTAMPTZ;
DROP INDEX uq_payments_active_ride;
CREATE UNIQUE INDEX uq_payments_active_ride ON payments(ride_id) WHERE ride_id IS NOT NULL AND payment_stage IS NULL AND status IN ('INITIATED','AUTHORIZED','CAPTURED');
CREATE UNIQUE INDEX uq_payments_active_stage ON payments(ride_id,payment_stage) WHERE payment_stage IS NOT NULL AND status IN ('INITIATED','AUTHORIZED','CAPTURED');
CREATE UNIQUE INDEX uq_logistics_provider_transaction ON payments(provider,provider_payment_id) WHERE payment_stage IS NOT NULL AND provider='cashfree' AND provider_payment_id IS NOT NULL;
CREATE TABLE logistics_payment_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE, actor_id UUID REFERENCES users(id), event_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE FUNCTION enforce_logistics_payment_stage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan logistics_ride_payment_plans; ride rides; due BIGINT;
BEGIN
 IF TG_OP='UPDATE' AND OLD.payment_stage IS NOT NULL AND (NEW.user_id,NEW.ride_id,NEW.payment_stage,NEW.amount,NEW.currency,NEW.provider) IS DISTINCT FROM (OLD.user_id,OLD.ride_id,OLD.payment_stage,OLD.amount,OLD.currency,OLD.provider) THEN RAISE EXCEPTION 'Logistics payment stage identity and amount are immutable'; END IF;
 IF NEW.ride_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO ride FROM rides WHERE id=NEW.ride_id FOR UPDATE;
 SELECT * INTO plan FROM logistics_ride_payment_plans WHERE ride_id=NEW.ride_id;
 IF NOT FOUND THEN
  IF NEW.payment_stage IS NOT NULL THEN RAISE EXCEPTION 'Stage requires a Logistics payment plan'; END IF; RETURN NEW;
 END IF;
 IF NEW.payment_stage IS NULL OR NEW.provider NOT IN ('cash','cashfree') OR NEW.currency<>plan.currency THEN RAISE EXCEPTION 'Invalid Logistics payment stage or method'; END IF;
 due:=CASE WHEN NEW.payment_stage='upfront' THEN plan.upfront_paise ELSE plan.final_paise END;
 IF round(NEW.amount*100)<>due THEN RAISE EXCEPTION 'Logistics stage amount mismatch'; END IF;
 IF TG_OP='INSERT' OR (NEW.status='CAPTURED' AND OLD.status IS DISTINCT FROM 'CAPTURED') THEN
  IF NEW.payment_stage='upfront' AND ride.status NOT IN ('driver_assigned','driver_arriving','driver_arrived') THEN RAISE EXCEPTION 'Upfront payment requires an accepted booking'; END IF;
  IF NEW.payment_stage='final' AND (ride.status<>'completed' OR NOT EXISTS(SELECT 1 FROM payments WHERE ride_id=ride.id AND payment_stage='upfront' AND status='CAPTURED')) THEN RAISE EXCEPTION 'Final payment requires delivery and confirmed upfront payment'; END IF;
  IF NEW.status='CAPTURED' AND NEW.provider='cash' AND (NEW.customer_claimed_at IS NULL OR NEW.cash_confirmed_by IS NULL OR NEW.cash_confirmed_at IS NULL OR NOT EXISTS(SELECT 1 FROM driver_profiles WHERE id=ride.assigned_driver_id AND user_id=NEW.cash_confirmed_by)) THEN RAISE EXCEPTION 'Cash receipt requires customer claim and assigned driver confirmation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER logistics_payment_integrity BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION enforce_logistics_payment_stage();
CREATE FUNCTION logistics_upfront_gate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.sector='logistics' AND (NEW.status='in_progress' OR (NEW.pin_verified AND NOT OLD.pin_verified)) AND EXISTS(SELECT 1 FROM logistics_ride_payment_plans WHERE ride_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM payments WHERE ride_id=NEW.id AND payment_stage='upfront' AND status='CAPTURED') THEN RAISE EXCEPTION 'Logistics upfront payment must be confirmed before pickup'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER logistics_upfront_gate BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION logistics_upfront_gate();

CREATE FUNCTION audit_logistics_payment_confirmation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.payment_stage IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
 INSERT INTO logistics_payment_events(payment_id,actor_id,event_type,metadata) VALUES(NEW.id,NEW.cash_confirmed_by,lower(NEW.status::text),jsonb_build_object('stage',NEW.payment_stage,'provider',NEW.provider,'providerPaymentId',NEW.provider_payment_id,'amount',NEW.amount));
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER logistics_payment_audit AFTER UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION audit_logistics_payment_confirmation();

CREATE FUNCTION lock_logistics_payment_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Booked Logistics payment plan is immutable'; END $$;
CREATE TRIGGER lock_logistics_payment_plan BEFORE UPDATE ON logistics_ride_payment_plans FOR EACH ROW EXECUTE FUNCTION lock_logistics_payment_plan();
