# Service Vehicles

Service bookings reuse rides, authenticated Socket.IO dispatch, offer leases, PIN start, cancellation and completion. Passenger, Premium, Logistics and Rental pricing retain their own rules.

## Configuration

Admin → **Service Vehicles** manages the existing `vehicle_types` catalog with `sector=service`. Each type has an independent `serviceFixedFare` in INR, `serviceRadiusMeters` (default 25,000; whole metres from 1 to 200,000), enabled state and optimistic `expectedVersion`. Names can change; permanent codes cannot. Existing Admin pricing permissions apply. Saves record the actor, old/new configuration and timestamp in `user_history`.

Service types cannot combine fixed Service pricing with scalar distance, hourly, demand or Logistics slab pricing. Missing, disabled or mixed configurations fail closed. Explicit zero fares are supported; no example or production fares are seeded by migration 096. The operator-approved Ambulance configuration for this release is INR 2,000 and 25 km. Other types require their own approved fares before activation.

A catalog type is separate from a physical vehicle. Physical vehicles must be registered, approved, active, assigned to an eligible driver and selected as that driver's active vehicle. The Service Vehicles page lists their driver, location timestamp, freshness, approval and operational status, and links to the existing vehicle management controls. Creating a fare does not approve a vehicle or substitute a home address for live GPS.

## Booking contract

1. Authenticated `GET /vehicles/catalog?sector=service` returns enabled, configured Service types.
2. Customer `POST /rides/service-availability` accepts the normal fare-estimate payload with `sector=service`, a catalog `vehicleCategory`, pickup and destination. It returns the fixed quote and `available`/`bookable`, without disclosing unassigned driver identities. No routing-provider call determines this fare.
3. Customer `POST /rides` requires a UUID `clientRequestId` for Service bookings. Send the returned `pricingQuote`; a client amount cannot override the server fare. Retain the same request ID across transport errors and app restarts. A changed booking intent needs a new ID.
4. The backend checks the approved Bihar service boundary and actual fresh driver GPS. An eligible vehicle must also lie inside its Service type's configured pickup radius. PostGIS geography distance includes the exact boundary. Offline, stale, missing-location, busy, unapproved, incompatible or unassigned vehicles remain ineligible.
5. Matching, offer creation, pending-offer recovery and atomic acceptance recheck eligibility. The latest configured radius and enabled state apply until acceptance. Accepted bookings retain their lifecycle; a later fare change does not reprice them.
6. The booking snapshot records type ID, code, version, `pricingModel=service_fixed`, fixed paise amount and radius. Distance, time, waiting, loading, fuel and demand do not add customer charges. Existing commission accounting is retained within the fixed total.
7. Per-customer request-ID uniqueness plus a transaction lock prevent concurrent duplicate inserts. Replays return the original booking, including after assignment or price changes. Reusing the ID for different coordinates/type/details returns `BOOKING_REQUEST_CONFLICT`. Existing offer/acceptance locks prevent multiple assignments.

## Deployment and rollback

Migration `096_service_vehicle_configuration.sql` adds Service configuration columns and nullable ride request IDs with a partial unique index. Existing prices and historical bookings are not rewritten. The existing driver-location GiST index supports the bounded geography lookup.

Take a managed database backup, verify the pending migration set and zero active bookings, apply migration 096 using the existing migration runner, then verify its recorded filename, columns and default radius. Build immutable backend/Admin images, preserve runtime configuration and secrets, and use the established single-owner guarded handoff before switching traffic. Install the updated Customer app before attempting Service bookings because request IDs are now required.

Prefer an application rollback while retaining additive schema columns. Before routing to an older backend that does not understand Service fixed fares/radius, disable newly configured Service types through the Admin APIs and finish active Service bookings. Preserve their pricing snapshots and request IDs. Do not automatically drop columns/indexes or restore a backup over newer bookings. Any later schema removal requires an explicit operator plan and archived data.

## Verification

The isolated Service database tests exercise 25 km boundaries, custom radius changes, Bihar coverage, inactive/unconfigured types, role checks, authenticated availability/catalog APIs, fare tampering, concurrent duplicate requests, acceptance races, arrival/PIN/completion, persisted fare/version and Admin visibility. Existing category lifecycle tests also cover every canonical category and supported duration. Customer tests cover fixed-price display, unavailable supply and durable retry IDs; Driver tests cover authoritative fixed-fare display and passenger wording regression.

Production acceptance still requires two connected phones and a genuinely eligible, approved Ambulance vehicle/driver with fresh compatible Bihar location history. Do not relabel a passenger vehicle, fabricate registration/approval documents, reset tracking history or bypass eligibility to obtain a passing live test.
