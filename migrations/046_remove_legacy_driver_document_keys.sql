-- Remove legacy driver document storage columns.
--
-- Driver documents are now managed through driver_documents.
-- These columns are no longer referenced by application code
-- and the current database contains no legacy data.

ALTER TABLE driver_profiles
    DROP COLUMN IF EXISTS license_document_key,
    DROP COLUMN IF EXISTS vehicle_rc_document_key,
    DROP COLUMN IF EXISTS profile_photo_key;