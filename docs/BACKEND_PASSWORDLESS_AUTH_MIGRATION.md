> Follow-up: the original schema failures are now fixed and the expanded backend suite passes. See [Backend authentication completion report](BACKEND_AUTH_COMPLETION_REPORT.md) for the MSG91 integration, current test results, and precise live-provider blockers.

# Backend passwordless authentication migration

Repository: https://github.com/Infurnus1234/Infurnus-new
Date: 18 October 2026

## Scope and working-tree preservation

Customer (`customer`) and Driver (`driver`) backend authentication now accepts OTP without a password. Other provider roles retain their existing password policy. Existing Customer and Driver Google authentication remains in place. Admin and Super Admin password verification, lock checks, RBAC and token/session creation were retained.

The checkout already contained extensive uncommitted backend and frontend work. This task did not edit any frontend file, Google authentication implementation, Admin service, Driver approval logic or existing migration. Do not treat the entire working-tree diff as this task's changes. Nothing was committed, pushed or deployed.

## Existing endpoint contracts

- `POST /auth/signup`: existing firstName/lastName, email and/or phone, role and onboarding fields. Customer/Driver password and confirmPassword are optional; legacy supplied passwords are not used to establish credentials. Driver licenseNumber/licenseExpiry remain required. SMS is selected when phone is supplied; otherwise email. Response retains signupId, contactType and expiresAt.
- `POST /auth/signup/verify`: signupId + six-digit otp; existing account creation transaction and tokens.
- `POST /auth/signup/resend`: existing cooldown and response.
- `POST /auth/login`: email and/or phone; password optional for Customers/Drivers. Existing accounts are resolved by normalized identifiers and database role; request role injection is rejected. Response retains challengeId/expiresAt. Unknown identities get an unpersisted opaque challenge rather than an account-existence error. New accounts still use signup and its required profile/onboarding fields.
- `POST /auth/login/verify`: challengeId + otp; existing atomic single-use challenge consumption, current account-status checks and token issuance.
- `POST /auth/login/resend`: existing channel selection and cooldown.
- `/auth/google`, `/auth/google/link`, `/auth/admin/login`, refresh, logout and session endpoints retain their existing implementations/contracts. Driver Google sign-in is already supported in this checkout, including driverFlow/providerRole signup intent.
- Customer/Driver forgot-password receives the existing generic response without creating a reset challenge. Previously issued reset challenges cannot complete a password update for these roles. Authenticated change-password is rejected for these roles. Administrative and other provider password recovery remains available.

## Identity and data handling

No accounts or related records are migrated, deleted, merged or re-keyed. Customer/Driver OTP login can resolve accounts with no user_credentials record. Password columns stay intact. New Customer/Driver signup writes an Argon2 hash of an undisclosed cryptographically random value to satisfy legacy non-null credential constraints; supplied passwords are ignored.

Phone signup does not claim the additional, unverified email for Customer/Driver accounts. Only the verified primary contact is persisted. Existing legacy secondary contacts explicitly marked unverified cannot be used for passwordless login; use the account's verified contact or existing Google flow. This prevents turning a previously unverified identifier into account access. Separately supplied email/phone identities are not merged without proof of ownership. Missing/conflicting contacts do not trigger role changes or automatic linking.

Driver signup still creates pending verification profiles. OTP does not approve documents, change operational availability, reset rejected/pending statuses or bypass eligibility. Suspended/banned user accounts remain blocked. Existing profile/status APIs continue to supply onboarding details.

## OTP providers and security

SMS and configured HTTP email delivery use the existing `OTP_PROVIDER_CONFIG` profiles (`config/otp-provider.example.json`). Configure each channel's send/verify/resend operations, credentials, success/error mappings, provider TTL and attempt reporting. Provider-managed codes must be cryptographically random, protected at rest, expiring, attempt-limited and single-use. These external provider guarantees and live delivery were not certified by mock-provider tests.

Email fallback uses `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. `AUTH_OTP_ENCRYPTION_KEY` remains the base64 32-byte secret used to encrypt provider session credentials. It also keys domain-separated, session-bound HMAC-SHA256 hashes for newly stored Resend verification codes. High-entropy session tokens retain their existing SHA-256 lookup representation. Outstanding legacy OTP hashes remain verifiable until their original expiry, so no destructive migration or active-session reset is needed. Never expose these environment values in logs.

`AUTH_EMAIL_OTP_TTL_SECONDS` configures local Resend code expiry (default 600, range 60–900). Configured HTTP profiles retain provider expiry settings. Existing `AUTH_OTP_RESEND_COOLDOWN_SECONDS` and AUTH_OTP_* rate limit settings remain in force. PostgreSQL Resend verification retains its row locks, attempt counters and atomic consume. Login challenge consumption remains atomic. JWT refresh rotation, revocation, secure cookies and existing CSRF middleware were not changed.

No real SMS/email was sent as part of validation. Supply actual provider configuration and validate delivery, throttling and provider verification guarantees before rollout.

## Files changed for this task

- src/config/env.ts (email OTP expiry setting)
- src/modules/auth/schemas/auth.schemas.ts
- src/modules/auth/types/login.ts
- src/modules/auth/types/resend-otp.ts
- src/modules/auth/services/login.service.ts
- src/modules/auth/services/signup.service.ts
- src/modules/auth/repositories/login.repository.ts
- src/modules/auth/repositories/password-reset.repository.ts
- src/modules/auth/repositories/resend-otp.repository.ts
- src/modules/auth/providers/resend-otp.provider.ts
- src/modules/auth/controllers/auth.controller.ts (Customer/Driver change-password guard)
- src/modules/auth/tests/passwordless-auth.test.ts (new)
- src/modules/auth/tests/passwordless-email-otp.test.ts (new)
- src/modules/auth/tests/auth.integration.test.ts
- src/modules/auth/tests/password-reset.integration.test.ts
- src/modules/auth/tests/generic-otp-auth.integration.test.ts
- docs/BACKEND_PASSWORDLESS_AUTH_MIGRATION.md

## Validation and blockers

Build (`npm run build`), ESLint on changed backend sources/tests and auth diff whitespace checks pass. Full backend run: 1,626 passed, 4 failed, 145 skipped. Logs: tmp/passwordless-backend-regression-final.log. The failures are one Driver Google onboarding/profile test missing driver_profiles.emergency_contact_relationship (defined in existing migration 051), and three ride reconciliation tests missing the provider_compliance_satisfied SQL function. No assertions were weakened to conceal these failures, and no unrelated database migrations were applied. Local schema needs reconciliation with the existing migrations before claiming all regression checks pass.

Final authentication suite: 383 passed, 1 failed (the same missing Driver profile column), across 35 files. The rerun is recorded in tmp/passwordless-auth-tests-final.log. Tests include passwordless phone/email signup and login, legacy account resolution, invalid/expired/replayed OTP, resend cooldown, duplicate prevention, role boundaries, Admin/Super Admin password login/recovery, Google identity regressions, refresh/session rotation and logout. Live provider delivery is unverified.

Frontend blocker: frontend/lib/features/auth/presentation/screens/login_screen.dart requires a nonempty password before submitting login (around lines 301/310). frontend/lib/features/auth/data/models/auth_models.dart also requires password in LoginRequest and password/confirmation in SignupRequest. Thus the backend accepts passwordless payloads, but the unchanged UI cannot expose a fully passwordless experience. No frontend changes were made. Existing clients can still submit their legacy fields; Customer/Driver backend authentication ignores their password.
