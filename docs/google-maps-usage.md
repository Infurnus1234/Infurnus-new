# Google Maps Usage

Google credentials are server-side only. `GOOGLE_MAPS_API_KEY` is optional in
local configuration, is never returned by an API, and must be supplied through
deployment secret management after the exposed key is revoked and rotated.

The intended provider boundary is a server-side `MapProvider` implemented by a
Google provider. PostGIS remains the source of truth for driver locations and
nearby-driver filtering. Socket.IO location updates must not call Google Routes
for every GPS update.

Configured controls are:

- `DRIVER_SEARCH_RADIUS_METERS` bounds the initial PostGIS search.
- `MAX_DRIVER_MATCH_CANDIDATES` bounds candidates before any route matrix call.
- `GOOGLE_ROUTE_RECALCULATION_INTERVAL_SECONDS` defaults to 30 seconds.
- `GOOGLE_ROUTE_RECALCULATION_DISTANCE_METERS` defaults to 500 metres.

Routes should be recalculated only after a threshold, assignment change, ride
start, destination change, or explicit invalidation. Places requests should be
debounced, length-limited, result-limited, and rate-limited. Geocoding should be
reserved for address workflows, never raw GPS persistence.

External failures degrade to spatial distance or another bounded fallback.
Retries require timeouts and a small cap. The server-side `MapProvider` and
`GoogleMapsProvider` are covered by mocked provider tests; no real Google API
call has been made and no claim of live Google API success is made.
