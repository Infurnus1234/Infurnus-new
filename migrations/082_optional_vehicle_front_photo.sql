-- Explicit product decision: vehicle-front photographs are optional. Keep
-- registration, insurance, ownership, identity and all other policies intact.
UPDATE provider_document_requirements
SET required=FALSE
WHERE document_code='vehicle_front_photo' AND required=TRUE;
