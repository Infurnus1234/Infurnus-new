> Resend dashboard follow-up: the dashboard was inspected, and the user explicitly approved registering infurnuslogistics.com. The domain entry is now created; its three DNS records are not yet published or verified. See [Resend DNS setup](RESEND_DNS_SETUP.md). Provider/security tests were rerun: 27 passed, zero failed. Live delivery remains blocked pending DNS verification.

# INFURNUS backend authentication completion report

Date: 18 October 2026. Repository: https://github.com/Infurnus1234/Infurnus-new
Branch: `feature/admin-request-visibility`.

## A. Implementation and audit findings

The four reported failures were reproduced before implementation (26 passing, 4 failing across the two affected files). Migration history on the existing localhost database contained migration 050 and Google migration 062, but not the outstanding 048/049 files or migrations 051–061. The objects were genuinely absent, rather than present under another function signature or search path.

All existing migrations first passed on a disposable database. The normal migration runner then applied the outstanding existing files to localhost/infurnus. Migration 051 supplied the Driver contact/location fields; migration 058 supplied the real `provider_compliance_satisfied(uuid,uuid,uuid,uuid,text)` function. No duplicate contact column or permissive replacement function was introduced. No production database was accessed.

The migration verification script now checks the missing Driver column, compliance function, and OTP attempt column. Its isolated functional checks prove that an active required-document rule blocks missing evidence, and that absent/inactive policy does not invent a requirement.

The existing Customer/Driver passwordless services, endpoint contracts, profile/onboarding behavior and legacy credential compatibility were preserved. Existing Google and Admin authentication implementations were not edited in this follow-up. Customer/Driver phone and email signup/login are exercised against actual PostgreSQL with an injected delivery provider; Driver verification remains pending after OTP authentication.

### SMS integration

Added an MSG91 SendOTP v5 profile to the existing GenericHttpOtpProvider; there is no competing provider architecture and no frontend SDK/widget dependency. The official current API examples were inspected, including their embedded public request/response data:

- [SendOTP](https://docs.msg91.com/otp/sendotp): POST `https://control.msg91.com/api/v5/otp`, `authkey` header, `template_id` and international `mobile`, explicit six-digit code length and configured expiry in minutes; response `request_id`.
- [Verify OTP](https://docs.msg91.com/otp/verify-otp): GET `/api/v5/otp/verify` with the mobile/code query and authkey header. Both `type=success` and the documented verification-success message must match. A send-success response cannot authenticate a user.
- [Resend OTP](https://docs.msg91.com/otp/resend-otp): GET `/api/v5/otp/retry`, authkey/mobile query and `retrytype=text`. The documented retry-success response is required.

MSG91 remains responsible for generating and checking its OTP. The backend adds encrypted challenge credentials, bounded verification attempts, atomic challenge consumption, existing request rate limits and resend cooldown. The MSG91 session envelope preserves its original expiry across retries; retrying the same provider code cannot extend the local authentication window. Authentication keys are referenced from environment variables, not included in source/config examples. The retry URL contains the provider-required key query; full provider URLs and errors must never be logged.

Credential failures, HTTP throttling/outages, template/balance/DLT rejection, invalid codes, expiry, timeouts and malformed recipients are rejected safely. Provider bodies and raw errors are not passed to API callers. MSG91 network requests use AbortSignal timeouts. The sender/template/DLT configuration must be established in the actual account before live readiness can be asserted.

### Email integration

Found and fixed a selection gap: a configured Resend key with no OTP_PROVIDER_CONFIG previously produced an empty HTTP-provider configuration and did not select Resend. The factory now selects the configured Resend fallback in that case. Explicit HTTP/email configurations and their existing fallback policy remain authoritative when supplied.

Resend retains cryptographic code generation, session-bound HMAC hashes, legacy code compatibility, PostgreSQL attempt counters and atomic single-use verification. Added bounded send waiting, sanitized network failures, and checks preventing expired, consumed or cooldown-blocked direct resends. A timed-out SDK request may still finish at the provider; a timeout is not reported as delivery success and does not create an authenticated session.

### Provider-independent attempts

Migration `063_bound_otp_verification_attempts.sql` adds a nonnegative, default-zero login verification counter. Pending signup uses its existing `otp_attempts` column. Both repositories reserve attempts with an atomic conditional UPDATE before calling a provider. Attempts remain bounded even if a vendor does not report its own remaining budget. Resending does not reset the budget. Active legacy sessions and account/session IDs are retained; no account or password-field migration is required.

## B. Files changed by this follow-up

The working tree already contained extensive unstaged and untracked backend/frontend work. The list below is based on hashes captured at the beginning of this follow-up, not the entire Git diff. No previously existing file was deleted. Existing deleted files in Git status were not restored or recreated.

### Backend authentication and configuration

- `src/config/env.ts`: MSG91 settings and challenge attempt limit.
- `src/modules/auth/repositories/login-challenge.repository.ts`: atomic login attempt reservation.
- `src/modules/auth/repositories/pending-signup.repository.ts`: atomic signup attempt reservation.
- `src/modules/auth/services/login-verification.service.ts`: provider-independent attempt enforcement.
- `src/modules/auth/services/signup-verification.service.ts`: provider-independent attempt enforcement.
- `.env.example`: placeholder-only provider/expiry/attempt settings.

### SMS/email providers

- `src/modules/auth/providers/msg91-profile.ts` (new).
- `src/modules/auth/providers/generic-http-otp.provider.ts`.
- `src/modules/auth/providers/otp-provider.factory.ts`.
- `src/modules/auth/providers/resend-otp.provider.ts`.
- `config/msg91-otp.example.json` (new).
- `config/otp-provider.example.json` (existing untracked example preserved and updated).

### Database migrations and test tooling

- `migrations/063_bound_otp_verification_attempts.sql` (new).
- `scripts/test-migrations.ts`.
- `scripts/test-backend-isolated.ts` (new).
- `package.json`: adds `test:backend:isolated`; existing scripts/dependency changes retained.

Existing migrations 048–061 were applied where pending, not rewritten. Their absence from local migration history caused the original defects. All 65 current migration files pass clean-database validation.

### Tests

- `src/modules/auth/tests/msg91-profile.test.ts` (new).
- `src/modules/auth/tests/msg91-factory.test.ts` (new).
- `src/modules/auth/tests/otp-attempts.integration.test.ts` (new).
- `src/modules/auth/tests/passwordless-email-otp.test.ts`.
- `src/modules/auth/tests/login-verification.service.test.ts`: supplies the real repository contract's new attempt-reservation method in the existing unit fixture; existing assertions retained.

### Documentation

- `docs/BACKEND_AUTH_COMPLETION_REPORT.md` (this file).
- `docs/BACKEND_PASSWORDLESS_AUTH_MIGRATION.md`: follow-up report link; original implementation history retained.

## C. Actual validation results

| Check | Result | Evidence |
|---|---|---|
| Backend build | PASS | `tmp/auth-completion/build-final.log` |
| ESLint, changed TypeScript including scripts | PASS, zero errors/warnings | `tmp/auth-completion/lint-final.log` |
| Clean migration/schema/function validation | PASS, 65 files | `tmp/auth-completion/migrations-063-isolated.log` |
| Focused authentication in fresh audit database | 410 passed, 0 failed, 0 skipped; 38 files | `tmp/auth-completion/isolated-auth.log` |
| Complete expanded backend suite | 1,800 passed, 0 failed, 1 intentionally skipped; 145 files | `tmp/auth-completion/isolated-full.log` |
| Targeted MSG91/email/attempt-limit tests | 27 passed, 0 failed; 4 files | `tmp/auth-completion/provider-final.log` |
| Original Driver Google and ride reconciliation regressions | 30 passed, 0 failed; 2 files | `tmp/auth-completion/schema-regressions-final.log` |
| Source secret/private-artifact scan | 0 findings | `node scripts/check-source-secrets.js` |
| Changed backend diff whitespace | PASS | `git diff --check` on task paths |

The expanded run enabled RIDE_DB_TESTS, PROVIDER_DB_TESTS, DRIVER_IMPLEMENTATION_DB_TESTS, COUPON_DB_TESTS, RENTAL_DB_TESTS, MAP_REDIS_TESTS and RIDE_LOAD_TESTS. The single skip is the existing storage-unavailable configuration test, conditional on Cloudinary already being configured; it is not a skipped authentication or database failure.

The expanded run used an isolated PostGIS 16/3.4 container bound only to loopback port 5434. The existing audit-port safety assertions were retained. It created a new named test database, ran every migration, then auth and full suites sequentially. The database and task-created container were removed after the run. Existing PostgreSQL/Redis containers were preserved. Only this task's disposable fixtures were cleaned up after earlier diagnostic failures.

`npm run test:backend:isolated` requires a local audit PostgreSQL server on port 5434. Set AUTH_TEST_DATABASE_URL to that disposable server's connection URL; the script never prints it. Optional Redis/load flags can be enabled as above. It refuses a remote database or the wrong audit port before starting. The existing standard `npm run test:migrations` remains available. No tests or assertions were removed or weakened to obtain the final results; earlier failing diagnostic logs remain under `tmp/auth-completion/`.

Google regressions use signed fixture identity tokens with the actual backend/database paths. They do not certify a live Google account session. Admin/Super Admin password login, incorrect passwords, locks, roles, recovery, refresh/logout and session behavior pass their regression tests without adding OTP to Admin login.

## D. Provider verification and required configuration

### MSG91

- A Chrome window titled for MSG91 was discovered.
- Account contents were **not inspected**: Computer Use stopped reading because it could not confidently determine the browser URL. The follow-up request to retrieve the key cannot override that tool safety block; no key was retrieved.
- No account security, permissions, billing, subscription or paid service was changed.
- MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are absent from the backend environment inspected for this run. An unrelated OTP_API_KEY is present; it was not assumed to be an MSG91 credential.
- No test mobile number was authorized, so no SMS was sent. Account credits, sender/DLT/template approvals, credential permissions and enabled OTP service remain unknown.
- Code/request construction/error handling were tested with mocks. Live SMS delivery and verification remain unverified.

Configure secrets locally or in the existing secret manager, never in chat/source:

| Setting | Purpose/default |
|---|---|
| MSG91_AUTH_KEY | Actual account API key; required with MSG91_TEMPLATE_ID |
| MSG91_TEMPLATE_ID | Approved **SendOTP template ID**, not an OTP Widget ID |
| MSG91_OTP_EXPIRY_MINUTES | Default 5; range 1–10; provider receives minutes |
| MSG91_TIMEOUT_MS | Default 10000; range 1–60000 |
| AUTH_OTP_MAX_ATTEMPTS | Default 5; range 1–10; shared signup/login budget |
| RESEND_API_KEY | Existing email delivery credential |
| RESEND_FROM_EMAIL | Verified-domain sender for unrestricted delivery |
| AUTH_EMAIL_OTP_TTL_SECONDS | Existing default 600; range 60–900 |
| AUTH_OTP_ENCRYPTION_KEY | Existing base64 32-byte encryption/HMAC secret |
| AUTH_OTP_RESEND_COOLDOWN_SECONDS | Existing default 60 |

When no explicit SMS HTTP profile exists and both MSG91 variables are present, the factory builds the profile. Partial MSG91 credential/template configuration is rejected at construction. Entirely absent SMS configuration leaves Google/Admin available and fails SMS requests safely. Explicit OTP_PROVIDER_CONFIG profiles retain precedence, including retained profiles for outstanding sessions. `config/msg91-otp.example.json` illustrates MSG91 with Resend; examples contain only environment references/placeholders.

See the official [setup requirements](https://msg91.com/help/sendotp/step-by-step-process-to-configure-otp), [template guide](https://msg91.com/help/sendotp/where-to-find-the-sendotp-api-how-to-get-template-id), and [expiry limits](https://msg91.com/help/sendotp/what-is-the-maximum-and-minimum-otp-expiry-time). Actual account approval/readiness still needs dashboard verification.

### Email

The user authorized one designated email address. A controlled attempt through the actual configured provider failed. A controlled diagnostic send identified HTTP 403 with the testing-recipient restriction: the current test sender can send only to the Resend account-owner inbox. A read-only domain query returned restricted_api_key, so domain readiness could not be inspected with this key. Neither keys nor full provider bodies were logged.

Required resolution: configure RESEND_FROM_EMAIL on a verified sending domain, or authorize the account-owner inbox for the provider's testing process. No message was accepted, no inbox receipt was confirmed, and no live OTP verification succeeded. Do not describe the email integration as live-delivery verified. Safe result evidence: `tmp/auth-completion/email-live-result.json`.

## E. Frontend and security confirmation

A start-of-task SHA-256 baseline covers 892 existing source files, including 368 frontend files. The final comparison shows **0 frontend modifications, 0 frontend additions, and 0 baseline files deleted**. The change manifest distinguishes this follow-up from prior changes: `tmp/auth-completion/change-manifest.json`. Unrelated pre-existing working-tree changes remain intact.

No frontend file, Google implementation, Admin authentication implementation, Driver approval implementation or existing migration was changed by this follow-up. Passwordless authentication, trusted role resolution, Google linking protections, current-account checks, onboarding restrictions, JWT/session handling and existing RBAC remain covered by passing tests. New random compatibility credentials from the earlier migration remain undisclosed and are not used as Customer/Driver login factors.

No live credential or OTP was added to repository sources/config examples. Nothing was committed, pushed, deployed, reset or discarded. Migration changes were exercised locally and in disposable databases only.

## F. Remaining blockers

1. MSG91 dashboard inspection is blocked by Computer Use URL verification. Actual SendOTP account/template/DLT/credits readiness is unknown; API key/template environment settings and an authorized test number are still needed.
2. Email live send is blocked by Resend's testing-recipient restriction. A verified-domain sender or authorized account-owner testing inbox is needed before delivery and actual OTP verification can pass.
3. The unchanged frontend still requires password input to submit its forms, as documented in the original migration report. Backend passwordless requests work, but the frontend cannot expose a blank-password flow without a separate authorized frontend change.

There are no unresolved automated build, lint, authentication, schema, compliance, ride, Redis or load-test failures in the final expanded audit. **The implementation is not declared production-ready while the live-provider and frontend-experience blockers remain.**
