# Rides API

The ride endpoints are mounted at `/rides` and require an access token:
`Authorization: Bearer <access-token>`. Ride ownership is enforced from the
authenticated user; a customer cannot read or cancel another customer's ride.

## Create a ride

`POST /rides`

```json
{
  "pickup": { "latitude": 12.9716, "longitude": 77.5946 },
  "destination": { "latitude": 12.9352, "longitude": 77.6245 },
  "pickupAddress": "Optional address",
  "destinationAddress": "Optional address"
}
```

Coordinates are validated as latitude `-90..90` and longitude `-180..180`.
Unknown fields are rejected. A successful response is `201` with
`{ "success": true, "data": <ride> }`.

## List rides

`GET /rides?status=completed&limit=20&cursor=<ISO timestamp>`

`status` is optional and may be `requested`, `searching`, `driver_assigned`,
`driver_arriving`, `driver_arrived`, `in_progress`, `completed`, or `cancelled`.
Results are ordered by `createdAt DESC, id DESC` and are limited to 100.

## Get and cancel

- `GET /rides/:id` returns the authenticated customer's ride.
- `POST /rides/:id/cancel` accepts `{ "reason": "Customer request" }`.

Cancellation is allowed before a ride starts. A missing ride returns `404`; a
ride in a non-cancellable state returns `409`.

## Lifecycle and realtime

The database lifecycle is `requested -> searching -> driver_assigned ->
driver_arriving -> driver_arrived -> in_progress -> completed`. Cancellation
is allowed from the pre-start states. Invalid transitions are rejected by the
database trigger. Drivers can use `POST /rides/:id/accept` and
`POST /rides/:id/status` after authentication and role authorization. Driver
availability is updated through `PATCH /rides/driver/availability`, and live
locations through `POST /rides/driver/location`.

Socket.IO uses `ride:join` and `ride:leave` for authorized rooms. Drivers can
emit `driver:accept`, `ride:status`, and `driver:location`. Room events include
`ride:driver_assigned`, `ride:lifecycle_updated`, and
`ride:driver_location_updated`. Disconnects mark driver availability stale
without destroying active ride state.

## Participant ride map contracts (MAP3)

Customer: GET /rides/:id/map. Assigned driver with driver role: GET /rides/driver/rides/:id/map. Strict optional includeRoute=true explicitly requests existing routing; default polling performs no provider request. SQL binds real customer/assigned driver identity. Terminal/unassigned rides expose no live location/active route; strangers 404, unauthenticated 401, wrong driver role 403.

Separate DTO views include rideId/view/type/status/category; fare (INR/bookedAmount/finalAmount/amount/authority); totalDistance (meters/source); pickup/drop (coordinates/address); driverLocation/userLocation (coordinates/timestamp or null); driverLocationFresh; pickupDistance/pickupEta; route/routeStatus/segment/progress/eta; routeVersion/updatedAt. Distance sources distinguish booking/geographic estimate/unavailable. ETA is provider_route or route_progress_estimate, not live traffic. Booking amount reads existing server-fixed fare_estimate; final fare is separate. No full entity/PIN/raw metadata/identity/history.

Opt-in customer sharing: POST /rides/:id/location with latitude/longitude/timestamp, or authenticated ride:user_location with those fields plus rideId. Only active assigned ride's owning customer may publish. Stale/future/older/terminal writes reject; service/socket state and rate limits bounded. ride:user_location_updated delivers rideId/location only to authorized rideRoom. Never infer current user position from pickup. Existing driver GPS events remain with late freshness/assignment/lifecycle guards.

Sanitized driver offer/current/action/history payloads add rideInformation (authoritative fare, canonical distance, endpoints/category/status), while raw billing/PIN remain stripped. Current trip queries active assignment. No new accept/reject/pricing decision. Google request-local routes need approved geometry/credentials; durable navigation retains MAP2 restriction. See [MAP3.md](../MAP3.md).
