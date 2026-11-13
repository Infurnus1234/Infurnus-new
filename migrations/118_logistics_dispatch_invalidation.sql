CREATE FUNCTION notify_logistics_dispatch_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('logistics_dispatch_changed', '');
  RETURN NULL;
END;
$$;

CREATE TRIGGER logistics_new_dispatch_changed AFTER INSERT ON rides
  FOR EACH ROW WHEN (NEW.sector='logistics')
  EXECUTE FUNCTION notify_logistics_dispatch_changed();
CREATE TRIGGER logistics_ride_dispatch_changed
  AFTER UPDATE OF status, logistics_escalated_at, logistics_escalation_reason, dispatch_driver_id ON rides
  FOR EACH ROW WHEN (NEW.sector='logistics' AND (
    OLD.status IS DISTINCT FROM NEW.status OR OLD.logistics_escalated_at IS DISTINCT FROM NEW.logistics_escalated_at
    OR OLD.logistics_escalation_reason IS DISTINCT FROM NEW.logistics_escalation_reason
    OR OLD.dispatch_driver_id IS DISTINCT FROM NEW.dispatch_driver_id))
  EXECUTE FUNCTION notify_logistics_dispatch_changed();
CREATE TRIGGER logistics_offer_dispatch_changed AFTER INSERT OR UPDATE OF status ON logistics_dispatch_offers
  FOR EACH ROW EXECUTE FUNCTION notify_logistics_dispatch_changed();
CREATE TRIGGER logistics_ring_dispatch_changed AFTER INSERT ON logistics_dispatch_rings
  FOR EACH ROW EXECUTE FUNCTION notify_logistics_dispatch_changed();
CREATE TRIGGER logistics_fulfillment_dispatch_changed AFTER INSERT OR UPDATE ON logistics_pickup_fulfillment
  FOR EACH ROW EXECUTE FUNCTION notify_logistics_dispatch_changed();

CREATE FUNCTION notify_logistics_driver_location_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM rides WHERE assigned_driver_id=NEW.id AND sector='logistics'
      AND status IN ('driver_assigned','driver_arriving','driver_arrived','in_progress')
  ) THEN
    PERFORM pg_notify('logistics_dispatch_changed', '');
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER logistics_driver_location_changed AFTER UPDATE OF last_location_at ON driver_profiles
  FOR EACH ROW WHEN (OLD.last_location_at IS DISTINCT FROM NEW.last_location_at)
  EXECUTE FUNCTION notify_logistics_driver_location_changed();
