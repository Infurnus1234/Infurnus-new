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

## Admin-managed vehicle types and exact fares (2026-10-05)

The existing `/admin/vehicles` resource remains physical vehicle inventory. Use the distinct `/admin/vehicle-types` catalog to configure a category used by the existing fare and booking APIs. These endpoints reuse the admin router's JWT and `admin`/`super_admin` middleware; pricing writes additionally verify an active, non-deleted administrator in PostgreSQL. Provider/partner modes grant no pricing permission.

| Method | Endpoint                                 | Operation                                                   |
| ------ | ---------------------------------------- | ----------------------------------------------------------- |
| POST   | `/admin/vehicle-types`                   | Create type with required exact prices; inactive by default |
| GET    | `/admin/vehicle-types?limit=25&offset=0` | List catalog, maximum 100 per page                          |
| GET    | `/admin/vehicle-types/:id`               | Read configuration and version                              |
| PATCH  | `/admin/vehicle-types/:id`               | Change name, prices and/or active state                     |
| PATCH  | `/admin/vehicle-types/:id/status`        | Enable/disable with version check                           |

Create example (test values, not production seed prices):

```json
{
  "name": "XYZ",
  "code": "xyz",
  "sector": "passenger",
  "baseFare": 100,
  "perKmRate": 15,
  "currency": "INR",
  "active": false
}
```

`code` is the `vehicleCategory` supplied to existing `/fares/estimate` and `/rides` requests and the `category` on approved physical vehicles. `sector` accepts passenger, logistics, service or premium. There is no extra category enum to edit for a new code. Code is unique across the catalog, immutable, lowercase, 1–50 characters, starts with a letter, and subsequently allows letters, digits and underscores. Name is trimmed, 1–100 characters. Exact rupee prices are required, finite, nonnegative, at most two decimal places and at most ₹99,999,999.99. Currency is INR. Unknown fields, client coercion, missing prices, invalid sector and unsupported route-based FTL configuration are rejected. Zero is allowed only when explicitly configured, never supplied as a missing-price fallback.

Responses follow `{ "success": true, "data": ... }`; data contains id, name, code, sector, baseFare/perKmRate in rupees, currency, active, version, createdAt and updatedAt. Creation returns 201. Activation example:

```json
{ "active": true, "expectedVersion": 1 }
```

Update example:

```json
{ "baseFare": 120, "perKmRate": 18, "expectedVersion": 2 }
```

Every PATCH requires the version last read. Concurrent writes with the same version have one winner; other writes return 409 `VEHICLE_TYPE_VERSION_CONFLICT`. Duplicate codes return 409 `VEHICLE_TYPE_DUPLICATE` with database uniqueness protection. Disabled types are retained for history; there is no destructive DELETE. Code/sector/currency are immutable to avoid rewriting historical identity. Canonical `mini` is configured for Mini Cab; existing estimate/booking alias `mini_cab` resolves to it and cannot create a conflicting catalog tariff.

### Authoritative fare and booking integration

PostgreSQL `vehicle_types` is the configuration source of truth. The existing `PostgresVehicleRepository` and `AdminService` are extended; there is no second vehicle repository, calculator, cache, auth system or Redis connection. `FareEstimateService` checks catalog availability before routing and reloads configuration after routing; `FareCalculatorService` performs the existing integer-paise rounding using the configured base and per-km rate. Admin configuration uses exactly base + distance, without introducing time, tax, waiting, loading, fuel or other components. Legacy unconfigured service/premium models retain their existing components. Unknown premium identifiers can no longer acquire a generic tariff; compatibility identifiers already used by the backend retain that legacy model, while arbitrary new codes use the catalog.

At 10 km, XYZ ₹100 + ₹15/km books ₹250. After changing to ₹120 + ₹18/km, future bookings use ₹300. Booking never trusts client `fareEstimate` or client rates. The server amount is persisted in `rides.fare_estimate`; the existing JSONB retains the fare breakdown, configured rates, type id, version, `pricingVersion` and distance. `pricingVersion` is `vehicle-type:<id>:v<version>`. Shared per-code transaction advisory locks also protect first-time catalog creation; a configuration row lock and final version/rate/status check occur in the same transaction as ride creation. Pricing changes after quoting return 409 `FARE_CONFIGURATION_CHANGED`; deactivation returns the existing 422 unavailable response. No stale cache can book old rates. Historical rides read their original amounts and snapshots, never current catalog prices. Configured premium completion retains the booked exact fare and does not attach legacy hourly/fuel billing.

Existing MAP3 customer/driver map and driver ride information use the same persisted amount and quote distance; no view recalculates pricing. Dispatch still requires approved, active, matching physical vehicle inventory and an eligible driver. Activating a type does not approve a physical vehicle or invent driver supply.

The supplied Bike, Auto, Mini Cab, Sedan, SUV, goods 3-Wheeler, Mini Truck/Tata Ace, Pickup 8ft and Tata 407 ranges remain intact. Configuring a canonical existing code supplies an exact booking quote while preserving the approximate range display. No range midpoint/default is inferred. Shared legacy identifiers keep their own sector's existing tariff, rather than consuming a different sector's configuration. FTL remains route-based/unavailable without approved route/truck rules; it cannot be enabled through this simple catalog. No production prices or example vehicle are seeded.

Unavailable configuration keeps `FARE_CONFIGURATION_MISSING` and the existing vehicle-not-yet-available message. Service-area failures remain the separate existing `SERVICE_AREA_UNAVAILABLE` response, "We're coming soon to your area." Missing quotes never become a Sedan/Mini Truck/zero fallback. User Map, Driver Map, GPS/socket, routing/ETA, dispatch and PostGIS/Redis behavior remain in their existing architecture.

### Migration and audit trail

Audit of all prior migrations found no pricing catalog. `vehicles` requires registration/ownership/driver fields and represents physical inventory; using dummy physical vehicles as fare types would break its governance and dispatch semantics. Minimal migration `048_create_vehicle_type_configuration.sql` adds the catalog, exact-paise bounds, code uniqueness/shape, sector/INR/status/version constraints and sector/status index. Historical inventory/rides and old migrations are not rewritten. The existing migration runner is forward-only and has no rollback framework. Both an existing database at all 48 prior migrations and a fresh database are verified by this pass.

Create/update and the existing `user_history` audit entry commit atomically. Entries record actor, action, type id, old/new configuration and timestamp; no JWT/password/secret is recorded. Concurrent updates lock the row and record only the winning change. No separate audit framework is introduced.

Validation evidence and exact CI results are appended to CHANGE.md. Tests are in `src/modules/vehicles/tests/vehicle-types.database.integration.test.ts`; external route distance alone is deterministic test data, while administrator JWT routes, catalog, calculator, ride creation, matching, assignment, persistence, map views and completion use real PostgreSQL/PostGIS. Production activation requires an authorized administrator to choose exact tariffs. FTL business rules and existing production map credentials/boundary remain owner inputs; no future admin frontend is required to use these backend APIs.
