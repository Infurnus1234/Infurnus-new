# Test Report

## Current status

The INFURNUS backend was verified locally with the PostGIS and Redis containers
running. Database migrations completed successfully, the API health endpoint
responded successfully, manual Postman API validation was completed, the full
automated test suite passed with no failed tests, and the TypeScript typecheck
passed.

## Verification run

- Total test files: 63
- Passed test files: 60
- Skipped test files: 3
- Failed test files: 0
- Total tests: 552
- Passed: 540
- Skipped: 12
- Failed: 0
- `npm test`: passed
- `npm run typecheck`: passed
- `npm run migrate`: passed; migrations 014–022 applied successfully
- API health check (`GET /health`): passed with HTTP 200
- Manual Postman API validation: 30 focused test cases completed
- Auth integration tests: 35/35 passed

### Manual Postman verification

The manual QA run covered authentication validation, protected endpoints,
health checks, unknown routes, and Vehicle API validation.

- Login validation: passed
- Refresh/logout/session authentication checks: passed
- User ID validation and not-found handling: passed
- Health endpoint: passed
- Unsupported HTTP method handling: passed
- Signup validation: passed
- Vehicle request validation: passed
- Vehicle list handling for a non-existent driver profile: passed
- Unknown route handling: passed

The manual valid-login scenario returned `401 INVALID_CREDENTIALS` because the
manually created test account was not successfully verified. This was not
treated as a confirmed backend defect because the automated authentication
integration test for signup verification followed by valid login passed.

No credentials, tokens, cookies, or secrets are included in this report.

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
