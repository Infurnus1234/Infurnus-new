# Temporary Driver onboarding without login

This removable testing feature adds only a restricted onboarding namespace. It does not change normal login, OTP, JWT validation, driver approval or vehicle-creation permissions.

## Enable in isolated local testing

Set `DRIVER_TEST_ONBOARDING_ENABLED=true` and `NODE_ENV=development` or `test` on a backend connected to a disposable local database. The flag defaults to `false`; staging and production reject the flow even if it is set to `true`. Never point this local test server at production data.

Build the separate Driver app in debug mode with its existing `DRIVER_TEST_API_BASE_URL` override pointing to this server, plus `--dart-define=DRIVER_TEST_ONBOARDING_ENABLED=true`. The login screen shows one secondary button only when this build flag and the backend capability both allow it. Release builds hide it.

## Scope and identity

- `GET /driver-test-onboarding/capabilities` reports availability.
- `POST /driver-test-onboarding/sessions` accepts an empty object and creates a new synthetic, unverified Driver account. It never accepts a caller-selected identity or role.
- The returned one-hour bearer session uses a separate derived signing key, audience and type. Normal APIs reject it. It has no refresh token or cookie, and the Driver app keeps it only in memory.
- Under this namespace, the existing account-name, driver-profile, document, assigned-vehicle read and provider-review handlers are reused. Only the session's own account can be updated. Contacts and roles cannot be changed.
- Existing file validation, document ownership, licence validation, document policy and review rules still apply. Cross-session reads and review requests are rejected.
- No ride, location, wallet, Admin, fleet or vehicle-creation API is exposed. Vehicle creation must use a separate authorized Admin through the existing `/vehicles` workflow. Creating a vehicle does not approve or activate it.

## Disable and remove

Set `DRIVER_TEST_ONBOARDING_ENABLED=false` and restart the local backend. Every temporary operation, including already-issued sessions, then returns 404. On its next request the app clears the temporary session and returns to login. Rebuild without the Driver define to omit the button entirely.

For permanent removal, remove `src/modules/driver-test-onboarding`, its app composition mount, the flag, and the isolated Driver client/button/route additions. Restore the provider-router authentication parameter to its existing default if no other caller uses it. Normal authentication requires no changes.

Synthetic accounts, profiles, documents and vehicles remain ordinary database records for inspection until the disposable test environment is cleaned up. Session expiry does not delete records or confer verified identity. Do not describe test fixtures as official licence, identity or registration verification.

## Tests

`router.test.ts` covers default/disabled/production denial, token separation and expiry, identity binding, validation, account isolation and forbidden APIs. `persistence.database.test.ts` uses the full application composition and real repositories when `DRIVER_IMPLEMENTATION_DB_TESTS=true`; run it only in the existing isolated database test harness. Existing normal-authentication suites remain unchanged.
