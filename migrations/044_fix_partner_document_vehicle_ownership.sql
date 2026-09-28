BEGIN;

CREATE OR REPLACE FUNCTION validate_partner_document_vehicle()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM vehicles v
        JOIN partners p
          ON p.user_id = v.owner_id
        WHERE v.id = NEW.vehicle_id
          AND p.id = NEW.partner_id
    ) THEN
        RAISE EXCEPTION 'Document vehicle does not belong to document partner';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;