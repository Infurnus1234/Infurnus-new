-- Local development files retain their actual provider identity.
ALTER TABLE driver_documents DROP CONSTRAINT driver_documents_storage_provider_ck;
ALTER TABLE driver_documents ADD CONSTRAINT driver_documents_storage_provider_ck
  CHECK (storage_provider IN ('cloudinary', 'local'));
