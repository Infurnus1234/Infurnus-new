# INFURNUS Backend Inspection

Inspection date: 2026-09-08

## Scope and repository state

The repository currently contains migrations `001` through `007`. There are no
migrations `008` through `011` in the workspace, so the requested ride work
cannot assume that those versions exist. The existing migration files use
explicit SQL transactions and preserve their versioned filenames. A migration
runner is now provided as `npm run migrate`, using a `schema_migrations` table;
the initial inspection found no such runner.

The current source tree contains modules for users, authentication, partners,
vehicles, and admin. The requested `rentals`, `logistics`, `payments`, and
`notifications` modules are not present and were not inspected as existing
abstractions.

## Backend architecture

- `src/app.ts` builds an Express application and wires module routers through
  dependency injection. `src/server.ts` supplies PostgreSQL repositories.
- Repositories receive a `pg.Pool`, use parameterized SQL, and return explicit
  projections with camel-case aliases. The vehicle repository is the closest
  example for driver-related data.
- Services contain business rules and translate database errors into
  `AppError` instances. Controllers parse Zod input, call services, and forward
  errors to centralized middleware.
- Routes apply `requireAuth` and role authorization where needed. Existing
  vehicle routes are currently wired without those middleware functions, so
  ride routes must explicitly protect every endpoint.
- `src/infrastructure/database/postgres.ts` provides a shared `Pool` and a
  `withTransaction` helper using `BEGIN`, `COMMIT`, and `ROLLBACK`.
- `src/common/middleware/error.middleware.ts` is the centralized HTTP error
  boundary. `AppError` carries a stable code and HTTP status.

## Database and migration findings

Migration `001_create_users_auth_foundation.sql` creates `pgcrypto`, the shared
timestamp trigger, `users`, `driver_profiles`, `vehicles`, authentication
tables, and the relevant enums. Important existing relationships are:

```text
users 1---1 driver_profiles
driver_profiles 1---many vehicles
users 1---many refresh_tokens
users 1---1 admin_credentials
```

The driver identity must therefore remain `driver_profiles.id`, while ride
ownership should reference `users.id` and driver assignment should reference
`driver_profiles.id`. Active vehicles are already constrained to one per driver
with `vehicles_one_active_per_driver_uidx`.

Migrations `002` through `005` add user preferences/history, partners, partner
constraints, and signup OTP data. Migration `006` verifies the pre-existing
vehicle table and its constraints. Migration `007` adds partner documents.

The existing database schema uses PostgreSQL enums, foreign keys, check
constraints, partial indexes, and timestamp triggers. PostGIS is not currently
enabled by the inspected migrations. Ride migration `012` must therefore either
enable it explicitly or fail clearly when the deployment does not provide the
PostGIS extension; it must not silently fall back to unrelated latitude and
longitude columns for spatial matching.

## Socket.IO findings

`createSocketServer` creates the Socket.IO server, applies
`authenticateSocket` as connection middleware, and configures CORS from the
environment. Authenticated identity is available at `socket.data.auth` with a
user ID and role. Existing helpers expose authenticated socket data and enforce
allowed roles. Ride rooms, driver location events, acceptance events, and
lifecycle events now reuse this foundation.

Ride socket handlers perform database-backed authorization before joining a ride
room, accepting a ride, advancing lifecycle state, or publishing driver
location.

## Configuration findings

`src/config/env.ts` validates all required environment variables at import time.
New ride and Google controls should be added there with safe defaults and
without logging credentials. The Google API key must remain server-side and
must not be placed in source, tests, documentation, or committed environment
files.

## Implementation constraints

1. The requested brief says the existing history ends at `011`, but this
   checkout ends at `007`; new work should use the next requested filename
   `012` and document that discrepancy rather than inventing migrations.
2. The migration runner tracks files for fresh databases. Existing deployments
   created before tracking was introduced require a one-time verified baseline.
3. PostGIS availability and the database connection must be confirmed in the
   target environment before migration execution.
4. Existing public module APIs and authentication behavior should remain
   unchanged. Ride behavior belongs in a new `rides` module and should use the
   existing pool, transaction helper, errors, validation, and socket auth.
5. The supplied Google API key is a credential. It is intentionally excluded
   from this repository and should be revoked/rotated before use.
