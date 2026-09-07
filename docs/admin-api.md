# Admin API

All routes require a Bearer access token and the existing `requireAuth` plus `requireRoles('admin', 'super_admin')` middleware. Normal users receive `403`; missing or invalid tokens receive `401`.

## Resources

- `GET /admin/users` and `GET /admin/users/:id`
- `GET /admin/partners` and `GET /admin/partners/:id`
- `GET /admin/vehicles` and `GET /admin/vehicles/:id`
- `GET /admin/dashboard`
- `GET /admin/reports/users`
- `GET /admin/reports/partners`
- `GET /admin/reports/vehicles`

List and report endpoints return `{ items, page, pageSize, total }` in `data`. Pagination defaults to `page=1&pageSize=25`; `pageSize` is limited to 100.

User filters are `search`, `role`, `status`, `from`, and `to`. Partner filters are `search`, `approvalStatus`, `availabilityStatus`, `documentStatus`, `complianceStatus`, `from`, and `to`. Vehicle filters are `partnerId`, `active`, `plate`, `make`, `model`, `documentStatus`, `complianceStatus`, `from`, and `to`. Compliance values are `compliant`, `non_compliant`, `expiring`, and `expired`. Dates use `YYYY-MM-DD`, and `from` cannot be after `to`.

The dashboard returns user totals/active/suspended, partner totals/approved/pending/active, vehicle totals/active, KYC pending/verified/rejected/expired, and insurance/permit/fitness records expiring within 30 days or already expired. Aggregates are computed in PostgreSQL.

Partner detail includes separate Aadhaar, PAN, driving licence, profile photo, and address-proof statuses plus a non-sensitive vehicle compliance summary for each associated vehicle: plate, active state, insurance status, permit status, and fitness status.

Admin projections must contain operational status only. They must never select or return password hashes, refresh-token hashes, OTP values, MFA secrets, or raw Aadhaar, PAN, or driving-licence numbers. Vehicle compliance is derived from document status and `expires_at`, with pagination and parameterized filters. Unknown fields, malformed UUIDs, invalid enum values, invalid dates, and invalid pagination return `400`; missing resources return `404`.

The partner document schema supports the required compliance dimensions through `partner_id`, optional `vehicle_id`, controlled document types and statuses, issue/expiry dates, verification timestamps, and JSON metadata. The schema migration is `migrations/007_create_partner_documents.sql`.

The existing vehicle schema contains plate, make, model, and driver-profile ownership but no registration-number column. Registration-number support therefore remains an architectural/schema decision and is intentionally not invented in this task.
