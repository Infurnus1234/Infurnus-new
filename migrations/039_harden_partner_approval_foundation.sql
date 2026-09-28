-- Migration 039: Harden Partner Approval Foundation
-- Adds reviewer/approval metadata and approval history
-- while preserving existing partner records.

BEGIN;

-- ============================================================
-- 1. Partner approval metadata
-- ============================================================

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID
    REFERENCES users(id)
    ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID
    REFERENCES users(id)
    ON DELETE RESTRICT;


-- ============================================================
-- 2. Partner approval history
-- ============================================================

CREATE TABLE IF NOT EXISTS partner_approval_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  partner_id UUID NOT NULL
    REFERENCES partners(id)
    ON DELETE RESTRICT,

  previous_status partner_approval_status,

  new_status partner_approval_status NOT NULL,

  acted_by UUID NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  reason TEXT,

  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT partner_approval_history_reason_ck
    CHECK (
      new_status <> 'rejected'
      OR (
        reason IS NOT NULL
        AND length(trim(reason)) > 0
      )
    )
);


-- ============================================================
-- 3. History indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS partner_approval_history_partner_idx
  ON partner_approval_history(partner_id);

CREATE INDEX IF NOT EXISTS partner_approval_history_actor_idx
  ON partner_approval_history(acted_by);

CREATE INDEX IF NOT EXISTS partner_approval_history_status_idx
  ON partner_approval_history(new_status);

CREATE INDEX IF NOT EXISTS partner_approval_history_acted_at_idx
  ON partner_approval_history(acted_at DESC);


-- ============================================================
-- 4. Approval metadata validation trigger
--
-- Important:
-- Existing legacy rows may not have reviewer metadata.
-- We therefore validate metadata only when the approval
-- lifecycle/status or approval metadata is being changed.
-- ============================================================

CREATE OR REPLACE FUNCTION validate_partner_approval_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- ----------------------------------------------------------
  -- Existing legacy rows are allowed to remain unchanged.
  -- ----------------------------------------------------------
  IF TG_OP = 'UPDATE'
     AND NEW.approval_status = OLD.approval_status
     AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
     AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by
     AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
     AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
  THEN
    RETURN NEW;
  END IF;


  -- ----------------------------------------------------------
  -- APPROVED requires complete approval metadata.
  -- ----------------------------------------------------------
  IF NEW.approval_status = 'approved' THEN
    IF NEW.approved_at IS NULL
       OR NEW.approved_by IS NULL
    THEN
      RAISE EXCEPTION
        'Approved partner must have approved_at and approved_by';
    END IF;
  END IF;


  -- ----------------------------------------------------------
  -- A new non-pending review state requires review metadata.
  -- ----------------------------------------------------------
  IF NEW.approval_status <> 'pending'
     AND (
       TG_OP = 'INSERT'
       OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
     )
  THEN
    IF NEW.reviewed_at IS NULL
       OR NEW.reviewed_by IS NULL
    THEN
      RAISE EXCEPTION
        'Partner approval review requires reviewed_at and reviewed_by';
    END IF;
  END IF;


  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS partners_validate_approval_metadata
  ON partners;

CREATE TRIGGER partners_validate_approval_metadata
BEFORE INSERT OR UPDATE ON partners
FOR EACH ROW
EXECUTE FUNCTION validate_partner_approval_metadata();


-- ============================================================
-- 5. Approval history validation
-- ============================================================

CREATE OR REPLACE FUNCTION validate_partner_approval_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.new_status = 'rejected'
     AND (
       NEW.reason IS NULL
       OR length(trim(NEW.reason)) = 0
     )
  THEN
    RAISE EXCEPTION
      'Rejection reason is required for partner approval history';
  END IF;

  IF NEW.previous_status IS NOT NULL
     AND NEW.previous_status = NEW.new_status
  THEN
    RAISE EXCEPTION
      'Partner approval status cannot transition to the same status';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS partner_approval_history_validate
  ON partner_approval_history;

CREATE TRIGGER partner_approval_history_validate
BEFORE INSERT ON partner_approval_history
FOR EACH ROW
EXECUTE FUNCTION validate_partner_approval_history();


-- ============================================================
-- 6. Documentation
-- ============================================================

COMMENT ON COLUMN partners.reviewed_at IS
  'Timestamp of the latest partner approval review action.';

COMMENT ON COLUMN partners.reviewed_by IS
  'User who performed the latest partner approval review action.';

COMMENT ON COLUMN partners.approved_at IS
  'Timestamp when the partner was approved.';

COMMENT ON COLUMN partners.approved_by IS
  'User who approved the partner.';

COMMENT ON TABLE partner_approval_history IS
  'History of partner approval lifecycle decisions.';


COMMIT;