BEGIN;

-- ============================================================
-- Harden Partner rejection reason consistency
--
-- Rejected partners must have a non-empty rejection reason.
-- Non-rejected partners must not have a rejection reason.
-- ============================================================

ALTER TABLE partners
DROP CONSTRAINT partners_rejection_reason_ck;

ALTER TABLE partners
ADD CONSTRAINT partners_rejection_reason_ck
CHECK (
    (
        approval_status = 'rejected'
        AND rejection_reason IS NOT NULL
        AND length(trim(rejection_reason)) > 0
    )
    OR
    (
        approval_status <> 'rejected'
        AND rejection_reason IS NULL
    )
);

COMMIT;