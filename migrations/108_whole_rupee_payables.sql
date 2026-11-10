-- Versioned constraints preserve completed bookings and plans with payment history.
ALTER TABLE logistics_ride_payment_plans ADD COLUMN whole_rupee_policy BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE logistics_ride_payment_plans ALTER COLUMN whole_rupee_policy SET DEFAULT TRUE;
ALTER TABLE logistics_ride_payment_plans DROP CONSTRAINT logistics_ride_payment_plans_check;
ALTER TABLE logistics_ride_payment_plans ADD CONSTRAINT logistics_plan_reconciliation CHECK (
 final_paise=total_paise-upfront_paise AND
 ((NOT whole_rupee_policy AND upfront_paise=round(total_paise*0.4)) OR
 (whole_rupee_policy AND total_paise%100=0 AND upfront_paise=round(total_paise*0.4/100)*100)));
CREATE OR REPLACE FUNCTION create_logistics_payment_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE total BIGINT; advance BIGINT;
BEGIN
 IF NEW.sector='logistics' AND NEW.fare_estimate>0 THEN
 total:=round(NEW.fare_estimate)*100;
 advance:=round(total*0.4/100)*100;
 INSERT INTO logistics_ride_payment_plans(ride_id,total_paise,upfront_paise,final_paise,whole_rupee_policy)
 VALUES(NEW.id,total,advance,total-advance,TRUE);
 END IF; RETURN NEW;
END $$;
-- New booking writes only; historical fares and payments are untouched.
CREATE FUNCTION finalize_new_ride_payable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.fare_estimate IS NOT NULL THEN NEW.fare_estimate:=round(NEW.fare_estimate); END IF;
 IF NEW.final_fare IS NOT NULL THEN NEW.final_fare:=round(NEW.final_fare); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ride_whole_rupee_payable BEFORE INSERT ON rides FOR EACH ROW EXECUTE FUNCTION finalize_new_ride_payable();


-- Upgrade only open, uncharged bookings. An existing payment in any state
-- freezes the prior contract so retries, refunds and audit history stay exact.
ALTER TABLE logistics_ride_payment_plans DISABLE TRIGGER lock_logistics_payment_plan;
UPDATE logistics_ride_payment_plans p
SET total_paise=round(p.total_paise/100.0)*100,
    upfront_paise=round(round(p.total_paise/100.0)*0.4)*100,
    final_paise=(round(p.total_paise/100.0)-round(round(p.total_paise/100.0)*0.4))*100,
    whole_rupee_policy=TRUE
FROM rides r
WHERE p.ride_id=r.id AND NOT p.whole_rupee_policy AND p.total_paise>=50
  AND r.status IN ('requested','searching','driver_assigned','driver_arriving','driver_arrived')
  AND NOT EXISTS(SELECT 1 FROM payments t WHERE t.ride_id=r.id);
ALTER TABLE logistics_ride_payment_plans ENABLE TRIGGER lock_logistics_payment_plan;
UPDATE rides r
SET fare_estimate=round(r.fare_estimate), final_fare=round(r.final_fare)
WHERE r.status IN ('requested','searching','driver_assigned','driver_arriving','driver_arrived')
  AND (r.fare_estimate<>round(r.fare_estimate) OR r.final_fare<>round(r.final_fare))
  AND NOT EXISTS(SELECT 1 FROM payments t WHERE t.ride_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM logistics_ride_payment_plans p WHERE p.ride_id=r.id AND NOT p.whole_rupee_policy);
