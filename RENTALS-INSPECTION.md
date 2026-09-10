\# INFURNUS Rentals Inspection

Inspection date: 2026-09-10

\## Scope

The Rentals module has been added under `src/modules/rentals`.

The existing `rentals` database schema was preserved. No existing migration

was rewritten. Migration `013\_rentals\_booking\_protection.sql` adds database

protection for rental booking concurrency and idempotency.

\## Architecture

The module follows:

Route → Controller → Service → Repository → PostgreSQL

\- Controllers handle authentication, Zod validation and API responses.

\- Services contain lifecycle, ownership, availability and idempotency rules.

\- Repositories use parameterized SQL and explicit projections.

\- Transactions use the shared PostgreSQL transaction helper.

\- Rental routes require authentication.

\## Lifecycle

Supported lifecycle:

PENDING → CONFIRMED → ACTIVE → COMPLETED

Cancellation is supported from PENDING and CONFIRMED.

Terminal states cannot transition further. Invalid lifecycle transitions are

rejected.

\## Authorization

Rental reads, lists and cancellation are scoped to the authenticated user.

A user cannot access another user's rental.

\## Validation

Create and cancellation requests use strict Zod schemas.

Create validation covers vehicle UUID, timezone-aware rental dates, valid rental

period, and the existing database-required amount/currency fields.

Unknown client fields are rejected.

No pricing or payment calculation logic was introduced.

\## Idempotency

Rental creation requires an `Idempotency-Key` header.

The database stores the key per user and enforces uniqueness. Retrying the same

request with the same key returns the existing rental instead of creating a

duplicate.

Reusing the same key with different rental details is rejected.

\## Double-booking protection

PostgreSQL provides database-level protection using a GiST exclusion

constraint over the vehicle and rental time range.

PENDING, CONFIRMED and ACTIVE rentals reserve the vehicle window.

Adjacent rental periods are allowed.

\## API

POST /rentals

GET /rentals

GET /rentals/:id

POST /rentals/:id/cancel

\## Verification

Rental tests passed:

\- Schema tests: 7/7

\- Service tests: 6/6

\- Route tests: 7/7

\- Database integration tests: 5/5

Repository verification:

\- npm run typecheck: PASS

\- npm run lint: PASS

\- npm run build: PASS

\- git diff --check: PASS

The full test suite had 452 passing tests and one unrelated JWT test failure

because `JWT\_ACCESS\_PREVIOUS\_SECRET` was not configured locally.

The repository-wide Prettier check reports existing formatting issues across

the repository, so the entire repository was not reformatted.
