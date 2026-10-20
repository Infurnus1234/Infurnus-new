# Backend OTP investigation — 18 October 2026

## Reproduced causes and fixes

0. **MSG91 DLT mismatch (external, confirmed).** The user confirmed no SMS arrived. The read-only OTP delivery log returned HTTP 200 and marks the authorized request at `2026-10-18 18:21:15` as **Failed**, with `failureReason: Template not matched on DLT`. An earlier matching-mobile entry has the same failure. API acceptance therefore did not prove delivery. Sanitized evidence: `tmp/otp-investigation/delivery-status.json`. No further SMS was sent. The approved DLT content/template mapping must be corrected in MSG91 before retrying; this is not an invalid-OTP or database failure.
1. **Resend account restriction (external, still blocked).** A controlled request to the previously authorized Gmail recipient returned HTTP 403 with the testing-recipient restriction. The configured sender remains the Resend test sender. This request was a delivery diagnostic without an OTP; it does not establish email OTP delivery or verification. Registering the business domain alone does not activate it. Publish the exact three records in [RESEND_DNS_SETUP.md](RESEND_DNS_SETUP.md), confirm Resend marks the domain verified, then explicitly authorize/configure a sender on that domain and repeat one backend email OTP flow. Do not replace the sender before verification. System DNS queries timed out during this investigation; that is not evidence of absent records.
2. **Factory test inherited live MSG91 configuration.** The existing missing-provider assertion failed because local MSG91 credentials now exist. Its call reached the live provider rather than exercising missing configuration. The test now explicitly removes both MSG91 settings while exercising that case and restores the environment afterward; its rejection assertion remains enabled. The isolated runner also excludes live delivery keys and external provider configuration and prevents dotenv from reloading them in child processes. Provider fixtures continue testing actual selection and transport behavior without paid delivery.
3. **Email resend reset verification attempts.** The existing real PostgreSQL resend test first submitted a wrong code, then resend reset attempts from one to zero. Strengthening its assertion to require one reproduced the failure before implementation changes (18 passed, 1 failed in the two-file reproduction). The repository now retains attempts and atomically refuses exhausted sessions. The provider checks exhaustion before sending an email. Added coverage proves exhausted sessions cannot resend or incur delivery. No rate limits, challenge consumption checks, or other security assertions were removed.

## Changes in this investigation

| File | Purpose |
| --- | --- |
| `src/modules/auth/repositories/resend-otp.repository.ts` | Preserve attempts and reject exhausted resend updates |
| `src/modules/auth/providers/resend-otp.provider.ts` | Reject exhausted sessions before delivery |
| `src/modules/auth/tests/resend-otp.repository.test.ts` | Assert preserved attempts and exhausted-session rejection against PostgreSQL |
| `src/modules/auth/tests/passwordless-email-otp.test.ts` | Verify exhausted sessions do not call Resend |
| `src/modules/auth/tests/otp-provider.factory.test.ts` | Isolate the intentionally unconfigured MSG91 case |
| `scripts/test-backend-isolated.ts` | Exclude live delivery credentials from automated child processes |

No schema migration or environment-variable changes are required by these fixes. Existing MSG91 profile configuration remains in place. Existing Google, Admin/Super Admin, passwordless Customer/Driver and onboarding implementations were not edited during this investigation.

## Verification evidence

- Initial sandboxed run: 25 passed, 13 failed; PostgreSQL operations were denied with `connect EACCES 127.0.0.1:5432`. This was a local tool/network permission failure, not a schema defect. Repeating with authorized local network access removed those connection failures; no migration or SQL workaround was applied.
- Original focused reproduction: 37 passed, 1 failed (factory missing-provider assertion); `tmp/otp-investigation/reproduction-baseline-network.log`.
- Attempt preservation reproduction before fix: 18 passed, 1 failed; `tmp/otp-investigation/attempt-budget-before-fix.log`.
- Focused final tests: **43 passed, 0 failed, 0 skipped across 5 files**; `tmp/otp-investigation/focused-final.log`.
- TypeScript build passed (`npm run build`); `tmp/otp-investigation/build.log`.
- ESLint passed for all six changed TypeScript files, including the isolated runner; `tmp/otp-investigation/lint.log` is empty.
- Changed-file secret scan found zero matches for the configured MSG91 key, Resend key and OTP encryption key. `git diff --check` passed for the six changed TypeScript files.
- Final fresh isolated migrations passed. Authentication: **412 passed, 0 failed, 0 skipped across 38 files**. Full backend regression: **1,802 passed, 0 failed, 1 existing skip across 145 files (144 passed, 1 skipped)**. Authentication took 36.20 seconds; full regression took 84.78 seconds. Final evidence: `tmp/otp-investigation/isolated-retry.log` and the detailed `tmp/auth-completion/isolated-*.log` files. Both generated databases were dropped by the runner's cleanup.
- First full run: **1,797 passed, 6 skipped**, with **1 failed suite, 143 passed suites and 1 skipped suite**. `map.redis.test.ts` timed out in its existing 10-second `beforeAll` hook, leaving its five tests unrun; the sixth skip is the existing configured-storage skip. Local Redis connected successfully. Without editing Redis/map code, timeouts or assertions, a focused rerun of `map.redis.test.ts` plus `redis.live.test.ts` passed **8 tests across 2 files** in 8.99 seconds. This demonstrates a setup timing failure in the first run rather than a reproducible OTP defect. Evidence: `tmp/otp-investigation/full-first-run.log`, `tmp/otp-investigation/redis-recheck.log`. The full isolated retry then passed with the same flags and unchanged limits. The sole remaining skip is the pre-existing storage-unavailable case, skipped because Cloudinary is configured.

Commands:

```powershell
$env:TEMP = Join-Path (Get-Location) 'tmp/auth-test-runtime'
$env:TMP = $env:TEMP
npx vitest run src/modules/auth/tests/resend-otp.repository.test.ts src/modules/auth/tests/passwordless-email-otp.test.ts src/modules/auth/tests/msg91-profile.test.ts src/modules/auth/tests/msg91-factory.test.ts src/modules/auth/tests/otp-provider.factory.test.ts --no-file-parallelism --reporter=dot
npm run build
npx eslint --no-ignore src/modules/auth/repositories/resend-otp.repository.ts src/modules/auth/providers/resend-otp.provider.ts src/modules/auth/tests/resend-otp.repository.test.ts src/modules/auth/tests/passwordless-email-otp.test.ts src/modules/auth/tests/otp-provider.factory.test.ts scripts/test-backend-isolated.ts
node tmp/otp-investigation/run-isolated.mjs
# Redis setup failure recheck (no test-limit changes)
$env:MAP_REDIS_TESTS = 'true'
npx vitest run src/modules/maps/tests/map.redis.test.ts src/infrastructure/redis/tests/redis.live.test.ts --no-file-parallelism --reporter=dot
```

The last ignored helper obtains local audit-server credentials only in memory (explicitly authorized by the user), then invokes `scripts/test-backend-isolated.ts`. That script creates, migrates, tests and drops only its newly generated database; it does not reset existing databases. A first attempt to create a separate container failed because port 5434 was occupied. Access to the existing audit container was initially rejected by automatic approval review and was retried only after explicit user approval.

## Live versus simulated provider status

| Provider | Automated coverage | Controlled live result |
| --- | --- | --- |
| MSG91 | Factory/profile transport, send/verify/retry, invalid codes, HTTP errors and expiry use fixtures, not paid SMS | One OTP request to the newly authorized mobile returned HTTP 200, `type=success`, and a request ID. The user confirmed no receipt; the delivery log marks it **Failed: Template not matched on DLT**. Positive backend verification is blocked until delivery is fixed. No OTP or key was printed. |
| Resend | Mocked SDK send/verify/error/cooldown coverage plus actual PostgreSQL attempt/session tests | HTTP 403 testing-recipient restriction for authorized Gmail. Email OTP delivery and positive live verification remain blocked. |

The controlled live probe used `node tmp/otp-investigation/live-probe.mjs`; sanitized results are in `tmp/otp-investigation/live-result.json`. Do not rerun it unnecessarily. A request ID proves acceptance, not delivery, DLT approval, or successful verification. No account, DNS, template, key, billing or sender settings were changed during this investigation.

### MSG91 action required

In MSG91 → OTP → Templates, compare the selected SendOTP template with the approved template exported from your DLT portal. Check its approved DLT Template ID, Entity/PE ID and associated sender/header, and match the message content and variables. Keep `MSG91_TEMPLATE_ID` as the MSG91 SendOTP template ID used by the API; map the separate approved DLT Template ID inside MSG91. MSG91 uses `##OTP##` while the DLT variable syntax is `{#var#}`. Do not invent or substitute an unapproved template. Once the mapping is corrected with authorization, send one controlled OTP and confirm both the delivery log and handset receipt before positive backend verification.

Official references: [DLT failure reasons](https://msg91.com/help/delivery-report/dlt-related-failure-reasons), [DLT debugging checklist](https://msg91.com/help/dlt-registration-in-india/dlt-debugging-checklist), [SendOTP template setup](https://msg91.com/help/sendotp/where-to-find-the-sendotp-api-how-to-get-template-id), [delivery report location](https://msg91.com/help/sendotp/where-to-find-sendotp-reports). The current SMS failure reason comes from the account's live API response, not an inference from these help pages.

## Preservation

Before edits, 901 existing files were hashed into `tmp/otp-investigation/baseline.json`. A later comparison found exactly the six TypeScript changes above and no missing baseline files. No frontend file changed. The extensive pre-existing dirty working tree was preserved. No commit, push or deployment was performed. The report and ignored diagnostic artifacts are additional files, separate from those six baseline changes.
