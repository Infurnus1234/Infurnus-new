# INFURNUS Backend Onboarding

Date: 2026-09-03

## Repository and tools

- Repository: `https://github.com/Infurnus1234/Infurnus-new.git`
- Checkout: `main`, aligned with `origin/main`
- Node.js: `v22.15.0`
- npm: `10.9.2`
- Docker and Docker Compose: not installed
- PostgreSQL client (`psql`): not installed
- Redis client (`redis-cli`): not installed
- REST-client collection: not present

## Current repository state

The repository is an initial scaffold. The following tracked files are empty:

- `package.json`
- `.env.example`
- `docker-compose.yml`
- `Dockerfile`
- `src/app.ts`
- `src/server.ts`
- `README.md`
- `eslint.config.js`
- `prettier.config.js`
- `tsconfig.json`

`npm install` cannot run because `package.json` contains no JSON. There is no application entrypoint, dependency manifest, database configuration, migration, schema, or API route to execute. The architecture document is the only substantive project documentation.

No local `.env` was created: `.env.example` has no keys or values to copy, and the repository does not yet provide a working configuration contract. No development database connection was attempted because no database URL/configuration or application database adapter exists. No REST client was configured because there are no runnable endpoints or collection definitions.

## Conventions understood

- The intended architecture is a modular monolith using Express and TypeScript.
- Routes handle routing, controllers handle HTTP concerns, services contain business logic, repositories handle persistence, and provider adapters isolate external systems.
- Validation is intended to use Zod and should cover body, query, path, and relevant headers.
- Errors are centralized and structured. Production errors must not expose stack traces, database internals, secrets, or provider details.
- Success responses follow `{ success: true, data, message }`; errors follow `{ success: false, error: { code, message } }`.
- Configuration is environment-driven and should be validated at startup, failing fast when required values are missing.
- Database changes must use version-controlled migrations, with PostgreSQL/PostGIS as the system of record and Redis/BullMQ for ephemeral/cache/queue workloads.
- Module and identifier naming conventions cannot yet be verified from implementation because no modules exist beyond empty entrypoint files. The architecture uses lowercase plural module directories such as `users`, `partners`, and `vehicles`.
- Intended workflow is install, typecheck, lint, test, and build in CI, with changes delivered through pull requests and code review.

## Users, Partners, and Vehicles

The architecture defines these as separate business modules:

- Users own profiles, saved addresses, preferences, and account history. Authentication internals remain conceptually separate from profile management.
- Partners own onboarding data, availability, history, and partner document metadata. A partner can be associated with vehicles.
- Vehicles own vehicle records, types, availability, status, and search/query behavior. Vehicle-partner association is managed across the Partners/Vehicles boundary.

The exact table columns, foreign keys, cardinality, indexes, and migrations are not available in this checkout and must be confirmed when the database design is added.

## Authentication understood

- Access tokens are short-lived JWTs, with the architecture recommending a 15-minute lifetime and only necessary claims.
- Refresh tokens are long-lived relative to access tokens, stored hashed server-side, and never stored raw.
- Successful refresh consumes/revokes the current refresh token and issues a new access token plus refresh token.
- Reuse of a consumed refresh token revokes its token family/session chain and requires fresh authentication.
- Authorization combines authentication state, role, permissions, resource ownership, and operation sensitivity. Example roles are `CUSTOMER`, `PARTNER`, `ADMIN`, and `SUPER_ADMIN`.
- Resource-level checks are required; authentication alone does not grant access to arbitrary records.

## Blockers and questions to raise

1. Please provide or merge the intended dependency manifest and implementation branch, or confirm that backend implementation is expected as a separate task.
2. Please provide the non-secret development environment contract and development database access details. Do not commit credentials.
3. Please install Docker Desktop (including Compose), or provide another approved PostgreSQL/PostGIS and Redis development setup.
4. Please provide the database schema/migrations for the Users, Partners, and Vehicles relationship review.
5. Please confirm the approved REST client and provide an API collection or runnable base URL once endpoints exist.
6. Please provide the expected Node.js version if `v22.15.0` is not the project standard.

No architectural changes were made during onboarding.
