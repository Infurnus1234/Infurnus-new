# Resend email OTP live investigation — 19 October 2026

## Summary

**PASS — Live email OTP delivered and verified.**

The authorized Gmail recipient confirmed receipt. Resend's Emails list marked the matching message **Delivered**. The existing backend `/auth/login/verify` endpoint returned HTTP 200, issued an access token and refresh cookie, and atomically consumed the login challenge. No OTP, token, API key or encryption key is included here.

The initial failure was a runtime sender configuration issue: even after the business domain became verified, the backend was still sending with Resend's restricted test sender. Changing only the local sender to `noreply@infurnuslogistics.com`, after confirming domain verification in the dashboard, resolved the failure. No authentication implementation change was required.

## Environment and configuration status

| Setting/check                      | Observed status                                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`                   | Configured; authorized for sending. Domain read returned HTTP 401 `restricted_api_key`, consistent with sending-only access, not evidence that the sending key is invalid. No key change was needed. |
| `RESEND_FROM_EMAIL`                | Initially effective Resend test sender; corrected locally to `noreply@infurnuslogistics.com`. The schema requires a plain email address, so a display-name format was not used.                      |
| `AUTH_EMAIL_OTP_TTL_SECONDS`       | Effective 600 seconds; unchanged.                                                                                                                                                                    |
| `AUTH_OTP_ENCRYPTION_KEY`          | Configured; decodes to 32 bytes; unchanged.                                                                                                                                                          |
| `AUTH_OTP_RESEND_COOLDOWN_SECONDS` | Effective 60 seconds; unchanged.                                                                                                                                                                     |
| Provider factory                   | Existing `createConfiguredOtpProvider(pool)` selects the Resend fallback for email. No email HTTP profile overrides it.                                                                              |
| Domain verification                | Resend dashboard showed `infurnuslogistics.com` **Verified**, with “Your domain is ready to send emails.”                                                                                            |
| DNS                                | Public DNS resolved TXT `resend._domainkey` and both CNAMEs. CNAME targets matched `rsend-apne1.forge.rmta.net` and `send.forge.rmta.net`. The task did not publish DNS.                             |
| Sender authorization               | Confirmed by the successful actual backend send using the verified-domain sender.                                                                                                                    |
| Runtime                            | Local backend application and existing local PostgreSQL; not a deployment or production-server test.                                                                                                 |

## Test evidence

All dates below use Asia/Calcutta (IST). ISO timestamps in ignored JSON evidence use UTC.

| Time (19 October 2026 IST) | Stage                                                                    | Result                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00:46:28                   | Preflight                                                                | Resend key and encryption key present; effective sender still used the test domain. All three public DNS records resolved. Domain API read returned 401 `restricted_api_key`.                                                                                                                     |
| 00:47:32                   | Existing `POST /auth/login`, email-only payload for authorized recipient | Backend HTTP **502**, `OTP_PROVIDER_SEND_FAILED`; real Resend HTTP **403**, `validation_error`, testing-recipient restriction. No provider message ID; zero new OTP sessions; no login challenge created.                                                                                         |
| 00:48:11                   | Failed correction attempt diagnostic                                     | A local edit helper stopped before applying the sender change, but the following command still ran the same backend request and received the same 403/502. No email was accepted. This extra rejected request was unnecessary; subsequent preflight confirmed the correction before another send. |
| 00:48:39                   | Corrected preflight                                                      | Verified-domain sender effective; test sender false; all three DNS records still resolved.                                                                                                                                                                                                        |
| 00:48:53                   | Existing `POST /auth/login`, same recipient and payload                  | Backend HTTP **200**; real Resend HTTP **200**; one new OTP session and a persisted login challenge. Message ID **`01a15073-defd-740b-8325-da92cefaa9b8`**.                                                                                                                                       |
| After accepted send        | Resend delivery status                                                   | Emails dashboard showed **Delivered** for that exact message ID and authorized recipient. Recipient independently confirmed receipt. No bounce, suppression or delivery failure was observed for the accepted request.                                                                            |
| 00:51:16                   | Existing `POST /auth/login/verify`, persisted challenge and received OTP | HTTP **200**; access token issued **true**; refresh cookie issued **true**; database challenge consumed **true**.                                                                                                                                                                                 |

The live harness imports the existing application, real provider factory and PostgreSQL repositories and sends HTTP requests through the established auth routes with Supertest. Rate limiting and CSRF protection retain their default enabled settings. It does not inject a mock OTP provider, generate an alternate OTP, call an alternate verification implementation, or seed/bypass a test identity. The authorized recipient already had a verified passwordless identity, so the real login flow was used.

A pass-through observer records only the real Resend response's HTTP status, message ID, error name and a sanitized reason; it does not record the outgoing message/OTP. Verification uses the actual persisted login challenge. Temporary OTP input was immediately cleared before verification; tokens and cookies were checked as booleans and were never printed or saved. Do not rerun the live send helpers unnecessarily.

Sanitized evidence (ignored local artifacts):

- `tmp/resend-live-investigation/backend-before-fix.json`
- `tmp/resend-live-investigation/preflight.json`
- `tmp/resend-live-investigation/backend-live-result.json`
- `tmp/resend-live-investigation/backend-verification.json`

## Problems identified

1. **Stale effective sender — configuration issue, fixed.** The domain was verified, but using the test sender still triggered Resend's account-owner recipient restriction. The backend correctly surfaced failure as HTTP 502 and did not persist a successful OTP session/challenge. The same endpoint succeeded after the sender correction. This was not a DNS, OTP-hash, expiry, or attempt-limit defect.
2. **Read restriction — diagnostic access limitation, not a sending defect.** Sending-only credentials cannot retrieve domain status. The domain's actual verification state was read from the already authorized dashboard. No broader API key was created and no security access was expanded.
3. **Setup documentation encouraged a test sender without explaining its restriction.** Added `.env.example` comments explaining the limitation, verified-domain sender configuration and restart requirement. No new test was added to assert documentation text; existing provider and authentication regressions exercise the actual failure and success paths.

## Fixes applied and files changed

| File                                     | Change                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env` (ignored, local only)             | Set only the Resend sender to the verified business domain; existing keys and security settings retained. New processes used the corrected setting. |
| `.env.example`                           | Add safe verified-sender guidance and test-sender limitation; contains no credentials.                                                              |
| `docs/RESEND_EMAIL_OTP_INVESTIGATION.md` | This investigation, evidence, commands and results.                                                                                                 |

Ignored diagnostic helpers/evidence under `tmp/resend-live-investigation/` support this run; they are not production application changes. No frontend or backend authentication implementation files were changed in this follow-up. No dashboard, DNS, billing, key, account-access or template changes were performed.

## Verification results

- TypeScript build: **passed**, `tmp/resend-live-investigation/build.log`.
- ESLint: **passed** for Resend provider, factory, repository, signup/login verification and resend services; no findings, `tmp/resend-live-investigation/lint.log`.
- Fresh isolated migrations: **passed**.
- Authentication suite: **412 passed, 0 failed, 0 skipped across 38 files**; current follow-up run, not a historical result.
- Focused Resend/provider tests: **24 passed, 0 failed, 0 skipped across 3 files**, `tmp/resend-live-investigation/focused.log`.
- Full backend regression: **1,802 passed, 0 failed, 1 existing skip across 145 files (144 passed, 1 skipped)**, `tmp/resend-live-investigation/isolated-tests.log`. Duration 103.19 seconds. The existing storage-unavailable case is skipped because Cloudinary is configured; no test was newly skipped or weakened.
- Live provider: **one accepted and delivered email**, positively verified through the backend. Two earlier rejected requests created no OTP sessions/challenges. Automated mocked-provider results are separate evidence, not proof of delivery.

Commands used (run from repository root):

```powershell
node tmp/resend-live-investigation/preflight.mjs
npx tsx tmp/resend-live-investigation/backend-live.ts
node tmp/resend-live-investigation/fix-sender.mjs
# Recheck effective configuration before the corrected live retry:
node tmp/resend-live-investigation/preflight.mjs
npx tsx tmp/resend-live-investigation/backend-live.ts
# User-supplied OTP input was local; no value is included in this report.
npx tsx tmp/resend-live-investigation/backend-verify.ts
npm run build
npx eslint --no-ignore src/modules/auth/providers/resend-otp.provider.ts src/modules/auth/providers/otp-provider.factory.ts src/modules/auth/repositories/resend-otp.repository.ts src/modules/auth/services/login-verification.service.ts src/modules/auth/services/signup-verification.service.ts src/modules/auth/services/login-resend.service.ts src/modules/auth/services/otp-resend.service.ts
node tmp/otp-investigation/run-isolated.mjs
$env:TEMP = Join-Path (Get-Location) 'tmp/auth-test-runtime'
$env:TMP = $env:TEMP
npx vitest run src/modules/auth/tests/passwordless-email-otp.test.ts src/modules/auth/tests/resend-otp.repository.test.ts src/modules/auth/tests/otp-provider.factory.test.ts --no-file-parallelism --reporter=dot
```

The last helper uses the explicitly authorized local audit PostgreSQL container, creates a fresh disposable database through `scripts/test-backend-isolated.ts`, migrates it, runs auth and full regressions serially with database/Redis/load integration flags, and drops only that generated database. Live email/SMS keys are excluded from automated child processes. No existing database was reset.

## Remaining actions and preservation

No external blocker remains for the verified local email login flow. Any already running backend process must restart or reload the corrected sender environment. A separately hosted backend needs the same verified sender configured in its own secret/environment store; this task did not change or deploy that environment. Repeat an authorized hosted test only if hosted verification is required.

Positive live coverage is the existing Customer/Driver passwordless login route for the authorized identity. Signup, Google, administrative authentication, resend/expiry/attempt/reuse controls and Driver onboarding are covered by the automated regressions, not by separate paid live emails in this follow-up. This pass does not claim universal inbox placement or hosted-environment delivery.

A preservation baseline hashed 902 existing files before edits. The comparison found only the intended `.env.example` change among those files and no deleted baseline file. The ignored `.env` sender change and new report/diagnostics are described above. Pre-existing frontend modifications and all unrelated working-tree changes were preserved. Nothing was committed, pushed or deployed.

## Final status

**PASS — Live email OTP delivered and verified.**

## Additional recipient test — podcave1@gmail.com

At **01:03:36 IST on 19 October 2026**, the user authorized a different recipient. One request through the existing `/auth/signup` route returned **HTTP 201**; the real Resend request returned **HTTP 200**, message ID `01a15081-5949-7262-9c8a-951e2a52d8dd`. One OTP session and pending signup challenge were created with rate limiting and CSRF protections enabled. No user account was created by verification in this additional test.

The Resend Emails dashboard subsequently displayed **Delivered** for `podcave1@gmail.com`. Recipient receipt and positive signup OTP verification have not yet been confirmed. Additional-recipient status: **PARTIAL — Email sent or delivered, but OTP verification remains unverified**. This does not change the earlier, fully verified login result for the original recipient. Sanitized evidence is in `tmp/resend-live-investigation/podcave-live-result.json`; no further configuration or application-code changes were needed.
