BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE ride_status AS ENUM (
    'requested',
    'searching',
    'driver_assigned',
    'driver_arriving',
    'driver_arrived',
    'in_progress',
    'completed',
    'cancelled'
);

CREATE TYPE driver_availability_status AS ENUM (
    'available',
    'unavailable',
    'busy',
    'stale'
);

ALTER TABLE driver_profiles
    ADD COLUMN availability_status driver_availability_status NOT NULL DEFAULT 'unavailable',
    ADD COLUMN last_location geography(Point, 4326),
    ADD COLUMN last_location_at TIMESTAMPTZ,
    ADD CONSTRAINT driver_profiles_location_timestamp_ck CHECK (
        (last_location IS NULL AND last_location_at IS NULL)
        OR (last_location IS NOT NULL AND last_location_at IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION driver_profiles_validate_availability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.availability_status = NEW.availability_status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.availability_status = 'available' AND NEW.availability_status IN ('unavailable', 'busy', 'stale')) OR
        (OLD.availability_status = 'unavailable' AND NEW.availability_status = 'available') OR
        (OLD.availability_status = 'busy' AND NEW.availability_status IN ('available', 'unavailable', 'stale')) OR
        (OLD.availability_status = 'stale' AND NEW.availability_status IN ('available', 'unavailable'))
    ) THEN
        RAISE EXCEPTION 'Invalid driver availability transition from % to %',
            OLD.availability_status, NEW.availability_status USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER driver_profiles_validate_availability
BEFORE UPDATE OF availability_status ON driver_profiles
FOR EACH ROW EXECUTE FUNCTION driver_profiles_validate_availability();

CREATE INDEX driver_profiles_available_location_gist_idx
    ON driver_profiles USING GIST (last_location)
    WHERE availability_status = 'available' AND last_location IS NOT NULL;

CREATE TABLE rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_driver_id UUID REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    assigned_vehicle_id UUID REFERENCES vehicles(id) ON DELETE RESTRICT,
    pickup_location geography(Point, 4326) NOT NULL,
    destination_location geography(Point, 4326) NOT NULL,
    pickup_address TEXT,
    destination_address TEXT,
    status ride_status NOT NULL DEFAULT 'requested',
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    route_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    location_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT rides_assignment_pair_ck CHECK (
        (assigned_driver_id IS NULL AND assigned_vehicle_id IS NULL)
        OR (assigned_driver_id IS NOT NULL AND assigned_vehicle_id IS NOT NULL)
    ),
    CONSTRAINT rides_cancellation_ck CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
        OR (status <> 'cancelled' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    ),
    CONSTRAINT rides_completion_ck CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
    ),
    CONSTRAINT rides_timestamps_ck CHECK (
        updated_at >= created_at
        AND (cancelled_at IS NULL OR cancelled_at >= created_at)
        AND (completed_at IS NULL OR completed_at >= created_at)
    )
);

CREATE OR REPLACE FUNCTION rides_validate_assignment_vehicle()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.assigned_driver_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM vehicles
        WHERE id = NEW.assigned_vehicle_id
          AND driver_profile_id = NEW.assigned_driver_id
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Assigned vehicle is not an active vehicle for the assigned driver'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rides_validate_assignment_vehicle
BEFORE INSERT OR UPDATE OF assigned_driver_id, assigned_vehicle_id ON rides
FOR EACH ROW EXECUTE FUNCTION rides_validate_assignment_vehicle();

CREATE INDEX rides_customer_created_idx ON rides(customer_id, created_at DESC, id DESC);
CREATE INDEX rides_status_created_idx ON rides(status, created_at DESC, id DESC);
CREATE INDEX rides_pickup_location_gist_idx ON rides USING GIST (pickup_location);

CREATE UNIQUE INDEX rides_one_active_per_driver_uidx
    ON rides(assigned_driver_id)
    WHERE assigned_driver_id IS NOT NULL
      AND status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress');

CREATE OR REPLACE FUNCTION rides_validate_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'requested' AND NEW.status = 'searching') OR
        (OLD.status = 'searching' AND NEW.status = 'driver_assigned') OR
        (OLD.status = 'driver_assigned' AND NEW.status = 'driver_arriving') OR
        (OLD.status = 'driver_arriving' AND NEW.status = 'driver_arrived') OR
        (OLD.status = 'driver_arrived' AND NEW.status = 'in_progress') OR
        (OLD.status = 'in_progress' AND NEW.status = 'completed') OR
        (OLD.status IN ('requested', 'searching', 'driver_assigned', 'driver_arriving', 'driver_arrived')
            AND NEW.status = 'cancelled')
    ) THEN
        RAISE EXCEPTION 'Invalid ride status transition from % to %', OLD.status, NEW.status
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rides_validate_transition
BEFORE UPDATE OF status ON rides
FOR EACH ROW EXECUTE FUNCTION rides_validate_transition();

CREATE TRIGGER rides_set_updated_at
BEFORE UPDATE ON rides
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

COMMIT;