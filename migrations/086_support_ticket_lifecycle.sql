BEGIN;

CREATE SEQUENCE support_ticket_number_seq AS BIGINT;
-- Keep existing ticket numbers; new tickets use a readable, concurrency-safe sequence.
DO $$
DECLARE highest BIGINT;
BEGIN
  SELECT MAX(substring(ticket_number FROM '^INF-SUP-([0-9]+)$')::BIGINT)
    INTO highest FROM support_tickets WHERE ticket_number ~ '^INF-SUP-[0-9]+$';
  IF highest IS NOT NULL THEN PERFORM setval('support_ticket_number_seq', highest); END IF;
END $$;
CREATE FUNCTION next_support_ticket_number() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT 'INF-SUP-' || CASE WHEN length(value) < 6 THEN lpad(value,6,'0') ELSE value END
  FROM (SELECT nextval('support_ticket_number_seq')::text AS value) sequence_value;
$$;
ALTER TABLE support_tickets ALTER COLUMN ticket_number SET DEFAULT next_support_ticket_number();
ALTER SEQUENCE support_ticket_number_seq OWNED BY support_tickets.ticket_number;
ALTER TABLE support_tickets ADD COLUMN request_id VARCHAR(64);
CREATE UNIQUE INDEX support_tickets_request_id_idx ON support_tickets(user_id, request_id);

COMMIT;
