# Backend authentication flow audit

Audit date: 19 October 2026 (Asia/Calcutta). Repository: Infurnus1234/Infurnus-new.

## Scope and Git baseline

The original `feature/admin-request-visibility` checkout was 66 commits behind the fetched `origin/main` and contained unrelated frontend/backend changes. It was preserved. The reviewed patch is prepared separately on `integration/backend-passwordless-audit-20261019`, based on `f6976395d501022855ec5253e0b399f8171c0d93`. It contains authentication/backend validation, two authentication migrations, tests, an isolated test runner, configuration examples and this report. It does not copy the old checkout wholesale or change frontend files, workflows, deployment configuration, Google implementation or Driver dispatch/approval implementation.

## Four flows and required fields

| Flow            | Initial endpoint    | Required payload                                                                                | Password     | Verification                                                  |
| --------------- | ------------------- | ----------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------- |
| Customer signup | `POST /auth/signup` | `firstName`, `lastName`, email **or** phone; role defaults to `customer`                        | Not required | `POST /auth/signup/verify` with `signupId`, six-digit `otp`   |
| Customer login  | `POST /auth/login`  | Email **or** phone for an existing active, verified identity                                    | Not required | `POST /auth/login/verify` with `challengeId`, six-digit `otp` |
| Driver signup   | `POST /auth/signup` | `firstName`, `lastName`, email **or** phone, `role: "driver"`, `licenseNumber`, `licenseExpiry` | Not required | Same signup verification endpoint                             |
| Driver login    | `POST /auth/login`  | Email **or** phone for an existing active, verified Driver identity                             | Not required | Same login verification endpoint                              |

**Email/phone plus OTP is sufficient for the identity/authentication step. Full registration still requires the existing name fields and, for Driver registration, licence fields.** Those business validations were deliberately preserved. An identifier-only signup request without required registration metadata remains a validation error. Neither flow requires both identifiers. Names must be nonempty, at most 100 characters each; licence number is nonempty, at most 50 characters; licence expiry must be a valid `YYYY-MM-DD` calendar date. An unexpired licence remains necessary for operational Driver eligibility.

Email is trimmed and lowercased. Phone accepts a country-coded number, optionally prefixed with `+`, according to the existing route regex (8–15 digits, nonzero initial digit); this task does not guess a missing country code. Leading/trailing whitespace is trimmed; internal formatting still follows existing route validation. The optional `+` is ignored for identity lookup and uniqueness, matching the SMS provider's recipient semantics. No existing account is silently merged or linked.

For backward compatibility, supplying both contacts remains supported. Signup selects phone/SMS as the primary contact and does not persist the unverified secondary email for Customer/Driver accounts. Login with both contacts rejects conflicts between different identities and uses SMS only when they resolve to the same account. Public login does not accept a caller-selected role; role comes from the database. Public signup excludes administrative roles. Fleet-owner roles retain their existing password, confirmation and business-name requirements; they were not converted to passwordless.

Legacy optional password fields remain accepted by the schema when valid, but Customer/Driver services do not authenticate with or persist a user-chosen password. A high-entropy random legacy credential satisfies the existing non-null password column without introducing a usable password login.

## Request and response sequences

Customer email example (replace the example recipient with an authorized address):

```json
POST /auth/signup
{"firstName":"Example","lastName":"Customer","email":"customer@example.com","role":"customer"}
```

Customer phone signup replaces `email` with `phone`, for example `+919876543210`. Driver signup adds `role: "driver"`, `licenseNumber` and `licenseExpiry`; email or phone remains alternative. The initial response is HTTP 201 with `{success:true,data:{signupId,contactType,expiresAt}}`. No account or session is issued before OTP verification.

```text
POST /auth/signup/verify  { signupId, otp }
POST /auth/login          { email } OR { phone }
POST /auth/login/verify   { challengeId, otp }
```

Login's initial response is HTTP 200 with `{success:true,data:{challengeId,expiresAt}}`, without access tokens/cookies. Successful signup/login verification returns HTTP 200 with `{success:true,data:{userId,accessToken,expiresAt,csrfToken}}`, a refresh-token cookie and CSRF cookie. Challenge consumption occurs before session issuance. The existing token signing, refresh rotation, revocation, cookie flags, origin/CSRF rules and role-based authorization remain in place.

Resend routes are `POST /auth/signup/resend {signupId}` and `POST /auth/login/resend {challengeId}`. They enforce the existing cooldown and route rate limits, and now atomically reject expired or exhausted challenges before reserving delivery. Resend cannot reset verification attempts. MSG91 retries retain the original SMS expiry. Email resend follows the existing provider TTL behavior within the same attempt budget. `POST /auth/refresh` retains the established refresh-cookie and CSRF contract; logout/session revocation routes are unchanged.

Unknown accounts, unverified legacy contacts, duplicate Customer/Driver registrations and already pending registrations receive opaque challenge-shaped responses to avoid account enumeration. These responses do not mean a provider message was sent, a real challenge was stored or authentication succeeded. Invalid/conflicting identifiers are rejected. An expired unverified pending signup can be replaced by a fresh attempt; active/exhausted attempts are not deleted to reset their budget. Reused, invalid, expired or exhausted OTPs do not issue tokens.

## Driver approval is separate from authentication

OTP verification establishes ownership and permits the existing registration/session flow. A new Driver profile remains `pending`; authentication does not mark documents, vehicles or the Driver approved. Pending/incomplete or rejected document onboarding can require access to profile/review correction routes. Suspended/banned/inactive user accounts cannot authenticate. Ride eligibility still requires the approved Driver and vehicle, valid licence, availability/location and configured compliance conditions enforced by the existing repositories. Customer tokens do not gain Driver/Admin roles or bypass Driver-only permissions.

## Google and administrative compatibility

`POST /auth/google` retains verified Google ID-token signup/signin. Existing Driver `driverFlow`/`providerRole` behavior and authenticated Google linking remain unchanged; a Google identity is not evidence of operational Driver approval. No Google account-linking rules were changed.

Admin and Super Admin retain password-only authentication through the existing login/admin-login policy. Valid credentials, active/unlocked state and administrative access checks remain mandatory; they do not become passwordless or use public OTP signup. Customer/Driver password change/recovery paths cannot introduce a password login. Existing administrative credential provisioning, permissions, RBAC and refresh behavior remain unchanged.

## Reproduced defects and corrections

1. **Latest-main Customer/Driver password dependence.** Six of nine focused passwordless tests failed against unmodified main because schemas/services still required a password. Passwordless handling is now limited to those two roles; password-backed administrative/fleet behavior remains protected.
2. **Provider configuration and automatic development fallback.** The main factory and the default controller could supply development OTPs when configuration was absent. Two default-application integration reproductions returned 201 instead of the required 503. Both automatic paths now use configured delivery and fail closed; explicit test providers remain injectable. Missing/partial MSG91 configuration fails on SMS use, without taking independent email/Admin authentication down at startup. Existing explicit generic HTTP profiles and real legacy email fallback tokens remain supported.
3. **Unbounded external-provider verification.** Conditional PostgreSQL attempt reservations now enforce `AUTH_OTP_MAX_ATTEMPTS` independently of provider-reported counters. Migration 067 adds the login attempt column; signup uses its existing counter. Correct concurrent verification cannot issue sessions through a reused challenge.
4. **Email OTP storage and resend budgets.** Resend codes are keyed to the encryption secret and session, with legacy code verification compatibility. Network requests have a bounded timeout and sanitized failures. Consumed/expired/exhausted sessions cannot resend, and resend preserves attempts. No provider rejection is reported as successful delivery.
5. **Expired/exhausted resend reservation.** New PostgreSQL integration assertions reproduced five failing cases where exhausted login/signup rows could reserve resend delivery. Atomic expiry/counter predicates now prevent this, including expired pending signup sessions.
6. **Expired signup dead end.** A fresh registration after expiry returned an opaque identifier without a usable pending row. A focused database reproduction failed one of seven tests. A conditional delete removes only an expired, unverified pending row before a new attempt; an old challenge remains unusable.
7. **Phone-prefix identity duplication.** Customer and Driver database tests reproduced duplicate pending accounts when switching the optional `+`. Lookups now recognize those aliases, reject ambiguous legacy identity results and preserve account ownership. Migration 068 adds canonical phone uniqueness for active users and pending phone registrations. Database tests assert duplicate insertion is rejected, including pending registration races.

## Backend files changed

| Files                                                                                                                                                                                                            | Purpose                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/auth/schemas/auth.schemas.ts`, `types/login.ts`, `services/signup.service.ts`, `services/login.service.ts`, `repositories/login.repository.ts`, `repositories/signup-user.repository.ts`            | Role-scoped passwordless contracts, verified contact checks, safe duplicate behavior and phone alias identity lookup                              |
| `controllers/auth.controller.ts`, `repositories/password-reset.repository.ts`                                                                                                                                    | Keep password-backed recovery/change paths from reintroducing Customer/Driver password authentication                                             |
| `repositories/login-challenge.repository.ts`, `repositories/pending-signup.repository.ts`, `services/login-verification.service.ts`, `services/signup-verification.service.ts`, `services/otp-resend.service.ts` | Atomic attempt/resend/expiry guards and expired pending-registration replacement                                                                  |
| `providers/otp-provider.factory.ts`, `providers/generic-http-otp.provider.ts`, new `providers/msg91-profile.ts`                                                                                                  | Fail-closed selection, existing transport-based MSG91 v5 send/verify/retry and bounded SMS session expiry                                         |
| `providers/resend-otp.provider.ts`, `repositories/resend-otp.repository.ts`, `types/resend-otp.ts`                                                                                                               | Keyed code verification, safe timeout/rejection handling and preserved resend budget                                                              |
| `src/config/env.ts`, `.env.example`                                                                                                                                                                              | Validated limits and secret-free MSG91/verified Resend sender configuration guidance                                                              |
| `migrations/067_bound_otp_verification_attempts.sql`, `migrations/068_unique_otp_phone_identity.sql`                                                                                                             | Provider-independent verification counter and database-enforced phone identity uniqueness                                                         |
| Auth tests, including new `passwordless-auth`, `passwordless-email-otp`, `msg91-profile`, `msg91-factory`, `otp-attempts.integration` tests                                                                      | Four role/channel combinations, token boundaries, invalid/reused/exhausted OTPs, aliases, expired retry and provider security regression coverage |
| `scripts/test-backend-isolated.ts`, `package.json`                                                                                                                                                               | Repeatable clean migrations and serial auth/full regressions on a newly owned disposable local database, excluding live delivery keys             |
| `docs/AUTHENTICATION_FLOW_AUDIT.md`                                                                                                                                                                              | Requirements, evidence and publication status                                                                                                     |

No frontend file, actual `.env`, credential, OTP value, token, private key or ignored diagnostic artifact belongs to the commit. Existing unrelated work in the original checkout is preserved.

## Migration safety and provider status

Migration 067 is additive. Migration 068 does not rewrite, merge or delete existing identities. If legacy canonical phone collisions exist, it aborts without exposing phone values; an operator must reconcile ownership explicitly before applying it to such a database. Both migrations are validated against fresh disposable PostgreSQL/PostGIS databases. No production migration or deployment is authorized or performed here.

The verified Resend domain and corrected local sender delivered an authorized email and completed real backend OTP login verification earlier on 19 October 2026. A separately authorized second recipient was marked Delivered, with signup verification still unconfirmed. Those are historical live-provider observations from the original local checkout, not new paid sends or proof of this branch's hosted deployment. This audit uses simulated provider transports and real isolated PostgreSQL/Redis for regression checks; no unnecessary live OTPs were sent.

The last live SMS test was externally blocked by MSG91 **“Template not matched on DLT”** in its delivery log; no later successful handset receipt/verification is established by this audit. API acceptance is not SMS receipt. Check/correct the selected MSG91 SendOTP template's approved DLT content/template ID, sender/header and entity mapping, then conduct one authorized delivery and verification test. The backend environment uses the MSG91 SendOTP template ID, not the separate DLT template ID. Production secrets or provider-side templates were not changed.

## Verification and publication

Baseline main: passwordless test **3 passed, 6 failed**. Later isolated reproductions separately established resend boundaries, expired registration and phone aliases before their fixes. An initial local JWT test needed its previous-secret fixture; the fixture was supplied without weakening the rotation test. The test runner was adapted to latest-main's existing `admin_master_test_<uuid>` ownership guard rather than relaxing that guard. A dependency junction caused local declaration-portability errors; an exact `npm ci` installation replaced that test setup, without unrelated application changes.

Final local validation passed on the stable patch:

| Check                                              | Result                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Exact lockfile `npm ci`                            | Passed; isolated dependencies installed                                      |
| Dependency audit                                   | Zero vulnerabilities at moderate-or-higher threshold (zero total findings)   |
| Authentication                                     | **428 passed, 0 failed, 0 skipped; 40 files**                                |
| Full backend                                       | **2,108 passed, 0 failed, 0 skipped; 167 files**                             |
| Exact licence-persistence/auth integration recheck | **26 passed, 0 failed, 0 skipped**                                           |
| Migrations                                         | **70 applied successfully**, clean-database schema/catalog validation passed |
| Typecheck and build                                | Passed                                                                       |
| Full ESLint and explicit isolated-runner lint      | Passed                                                                       |
| Reviewed-file Prettier and whitespace checks       | Passed                                                                       |
| Source/private-artifact scan                       | **954 files, 0 findings**                                                    |
| Reviewed candidate scan against configured secrets | **37 files, 0 secret matches, 0 frontend files**                             |

The stable full run took 288.89 seconds and used actual disposable PostgreSQL/PostGIS and Redis, including dispatch/load integrations. Final ignored evidence is `tmp/auth-audit/final-stable-validation.log`; detailed suite logs are under `tmp/auth-completion/`. No required check was disabled, newly skipped or weakened. GitHub evidence is recorded below separately from the local results.

Commands:

```powershell
npm ci
npm audit --audit-level=moderate
node scripts/check-source-secrets.js
npm run typecheck
npm run lint
npm run build
# Set AUTH_TEST_DATABASE_URL to the authorized local audit PostgreSQL server
# on port 5434, and supply only synthetic JWT/encryption fixtures for this run.
npm run test:backend:isolated
# Check only the reviewed changed files, matching the existing CI workflow:
npx prettier --check <reviewed-changed-files>
```

The isolated runner creates `admin_master_test_<random-uuid>`, migrates it, validates another clean migration database, runs auth and full tests serially, then drops only its own generated database. Database, Redis, dispatch and load integration flags are enabled for the final audit. Live email/SMS keys are excluded from its child processes. Local evidence is ignored under `tmp/auth-audit/` and `tmp/auth-completion/` and is not pushed.

Publication target: the isolated integration branch above, using a normal non-force push after local validation. The existing GitHub workflow runs on integration branches and enforces dependency audit, source scanning, migrations, typecheck, lint, formatting, tests, optional-storage checks and build. No workflows or branch protections are changed; the latest main workflow was already successful at the audited baseline. Actual pushed-commit CI must complete before this task is declared successful. No production deployment is part of this task.

## GitHub publication and verified CI

- Implementation pushed: [`afd2752abebb57dddd58c1ed8ed768e60c85761e`](https://github.com/Infurnus1234/Infurnus-new/commit/afd2752abebb57dddd58c1ed8ed768e60c85761e), `fix(auth): secure passwordless customer and driver authentication`.
- Review: [PR #25](https://github.com/Infurnus1234/Infurnus-new/pull/25), from `integration/backend-passwordless-audit-20261019` into `main`. It is not merged.
- Actual implementation push CI: **SUCCESS**, [run 39161778983](https://github.com/Infurnus1234/Infurnus-new/actions/runs/39161778983).
- Actual implementation PR quality job: **SUCCESS**, [run 39161845239](https://github.com/Infurnus1234/Infurnus-new/actions/runs/39161845239).
- Both required quality jobs passed dependency security audit, private-artifact scan, disposable database creation, migrations and clean-schema verification, typecheck, lint, formatting, backend tests, the separate optional-storage test and build. These results were read from GitHub Actions for the pushed revision, not inferred from local success.
- This report receives a documentation-only follow-up commit to record those observed results. The current head's authoritative result is available in [PR checks](https://github.com/Infurnus1234/Infurnus-new/pull/25/checks) and the [branch CI history](https://github.com/Infurnus1234/Infurnus-new/actions?query=branch%3Aintegration%2Fbackend-passwordless-audit-20261019); final reporting also verifies that follow-up's checks.
- The original checkout's Git status was compared with its pre-task snapshot and remained unchanged. No frontend, unrelated work, secrets or local diagnostic artifacts were committed. There was no force push, merge, branch-protection bypass, production migration or deployment.
