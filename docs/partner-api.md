# Partner API

## Onboarding

The onboarding sequence is account, partner profile, identity and driver documents, vehicle association, vehicle documents, and availability. The existing `users`, `driver_profiles`, and `vehicles` tables are reused; migration `007_create_partner_documents.sql` adds metadata-only KYC records.

## Partner profile

All partner endpoints require a Bearer access token. A partner may access only the profile tied to the authenticated user. `admin` and `super_admin` may access partner profiles; partner listing is admin-only.

- `POST /partners` creates a profile with `userId`, `businessName`, and optional `businessDescription`.
- `GET /partners/:id` returns the partner profile projection.
- `PATCH /partners/:id` updates `businessName`, `businessDescription`, or `availabilityStatus`.
- `PATCH /partners/:id/availability` updates only `availabilityStatus` (`offline`, `available`, or `unavailable`).

Approval fields and timestamps are database-managed and cannot be updated by these endpoints.

## Documents

- `GET /partners/:id/documents`
- `POST /partners/:id/documents`
- `PATCH /partners/:id/documents/:documentId`

Supported document types are `AADHAAR`, `PAN`, `DRIVING_LICENCE`, `PROFILE_PHOTO`, `ADDRESS_PROOF`, `VEHICLE_RC`, `VEHICLE_INSURANCE`, `VEHICLE_PERMIT`, `VEHICLE_FITNESS`, and `OTHER`. Statuses are `PENDING`, `SUBMITTED`, `VERIFIED`, `REJECTED`, and `EXPIRED`.

Lifecycle transitions are `PENDING -> SUBMITTED`, `SUBMITTED -> VERIFIED|REJECTED`, `REJECTED -> SUBMITTED`, and `VERIFIED -> EXPIRED`. New records start as `PENDING`. Verification sets `verified_at`; rejection and resubmission clear it; expiration requires a past `expires_at` and preserves the verification timestamp. These rules are enforced in both the service and the database trigger.

These endpoints store safe metadata only. They do not accept or persist Aadhaar, PAN, or driving-licence numbers, and they do not upload files or create cloud storage credentials. A document linked to a vehicle is accepted only when the vehicle belongs to the partner through the existing driver profile relationship. Arbitrary internal metadata is omitted from API responses. Any future masked or hashed identifier design requires explicit review.

Dates use `YYYY-MM-DD`. Unknown fields, invalid UUIDs, enums, and date ranges are rejected with `400`. Missing partners or invalid vehicle ownership return `404`; duplicate required document types return `409`.

Responses use `{ success, data, message }` for successful writes/reads. Errors use `{ success: false, error: { code, message } }`. Unauthenticated requests return `401`; authenticated users accessing another partner return `403`.
