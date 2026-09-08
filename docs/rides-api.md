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
