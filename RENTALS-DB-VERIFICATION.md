\# Rentals Database Verification

Verification date: 2026-09-10

\## Migration

Existing Rentals migrations were preserved.

New migration:

`migrations/013\_rentals\_booking\_protection.sql`

The migration enables `btree\_gist`, adds `idempotency\_key`, creates a unique

partial index for idempotency keys, and adds a PostgreSQL GiST exclusion

constraint for vehicle booking periods.

\## Booking protection

The exclusion constraint protects:

`vehicle\_id + tstzrange(start\_at, end\_at, '\[)')`

for:

\- PENDING

\- CONFIRMED

\- ACTIVE

Overlapping bookings for the same vehicle are rejected.

Adjacent periods are allowed.

COMPLETED and CANCELLED rentals no longer reserve the vehicle window.

\## Idempotency

The database creates a unique partial index on:

`(user\_id, idempotency\_key)`

This prevents duplicate bookings when the same authenticated user retries

with the same Idempotency-Key.

\## Migration verification

Clean temporary database migration verification passed.

Migration count: 14

Verified existing ride/PostGIS/index/foreign-key migration checks successfully.

Command:

`npm run test:migrations`

Result: PASS

\## Rental database tests

Database integration tests: 5/5 passed.

Verified:

1\. Rental creation.

2\. Overlapping booking rejection.

3\. Adjacent periods allowed.

4\. Same-key idempotent retry.

5\. Same-key different-details conflict.

6\. Ten concurrent overlapping booking attempts produce exactly one

&#x20; successful booking.

\## Environment

Verification used the local PostgreSQL database configured through

`DATABASE\_URL`.

Secrets were supplied through environment variables and were not committed.
