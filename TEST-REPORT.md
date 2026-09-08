# Test Report

## Current status

The ride foundation, driver lifecycle, PostGIS matching, transactional
assignment, Socket.IO handlers, and guarded Google provider are implemented.
The complete suite was run with the local PostGIS container enabled.

## Verification run

- Total test files: 53
- Total tests: 398
- Passed: 398
- Failed: 0
- Skipped: 0
- `npm test` with `RIDE_DB_TESTS=true` and `RIDE_LOAD_TESTS=true`: passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed
- targeted Prettier check for changed files: passed
- `npm run format:check`: failed on 80 pre-existing files outside
  the focused change set; changed files pass the targeted check
- `git diff --check`: passed
- `npm run migrate`: passed; migration 012 tracked
- `npm run test:migrations`: passed against a clean disposable PostGIS database

## Coverage gaps

Coverage includes validation, driver availability/location rules, stale and
out-of-order timestamps, PostGIS spatial filtering, deterministic matching,
atomic assignment, lifecycle constraints, duplicate cancellation, Socket.IO
authentication/rooms/events, Google timeout/retry/rate/candidate safeguards,
and security-sensitive ownership checks in the existing suite.

The 100-concurrent acceptance test completed in approximately 504 ms in the
final run against the local PostGIS container, with 1 winner and 99 conflicts.

Controlled load result: 20 Socket.IO clients, 500 location updates, 100
matching requests, 20 acceptance attempts, and 20 disconnect/reconnect cycles.
The final run measured 0 location failures, 0 acceptance conflicts in the
mocked benchmark, connect latency 166.87 ms, location latency 215.79 ms,
matching latency 0.62 ms, acceptance latency 17.23 ms, reconnect latency
192.01 ms, and 0 Google requests. This is a bounded benchmark, not a capacity
claim.

The reconnect integration test passed the full connect/authenticate/join,
disconnect/reconnect/restore flow, duplicate join protection, stale room
cleanup, single event delivery, and unauthorized restoration rejection.

Concurrency result: 1 successful assignment and 99 rejected attempts. Driver
contention, duplicate cancellation, invalid transitions, and rollback behavior
passed against PostgreSQL.

Google result: provider and cost-control tests passed with mocked fetch; no real
Google request was made. Socket result: authentication, authorization, room,
reconnect, location, lifecycle, and controlled load tests passed. Database
result: live PostGIS, spatial indexes, constraints, migrations, and concurrency
tests passed.

Clean migration evidence: `test:migrations` created a disposable database,
executed all 9 files through `npm run migrate` (001-007 and 012), verified
`rides`, PostGIS, `rides_one_active_per_driver_uidx`,
`driver_profiles_available_location_gist_idx`, `rides_validate_transition`,
and `rides_customer_id_fkey`, then dropped the database.

Repository-wide formatting remains limited by pre-existing formatting failures
in 80 unrelated files. Targeted formatting for all changed files passes. The
existing `.gitignore` working-tree change was not modified.

No real Google API call was made and no credential is included in this report.
