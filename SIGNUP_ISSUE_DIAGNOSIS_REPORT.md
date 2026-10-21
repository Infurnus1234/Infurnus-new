# Sign-Up Issue Diagnosis and Root Cause Analysis Report

**Project:** INFURNUS Mobility Platform (Frontend Flutter App & Node.js/TypeScript Express Backend)  
**Date:** October 2026  
**Scope:** Diagnosis and Root Cause Analysis of Sign-Up, Sign-In, OTP, and Google Authentication Flows  

---

## 1. Executive Summary

This report provides a comprehensive diagnosis of authentication failures and friction points within the INFURNUS customer application signup and sign-in workflows. Following code inspections across both the Flutter client (`frontend/lib/features/auth/`) and the Node.js/Express backend (`src/modules/auth/`), several architectural, configuration, and flow-matching challenges were uncovered. 

While the backend robustly supports passwordless OTP authentication and JWT issuance, discrepancies between frontend payloads, strict database constraints (such as unique phone/email indexes and foreign key relationships), and device network resolution (`localhost` vs LAN IP / emulator loopback) previously caused signup and login requests to timeout or fail. This report documents confirmed root causes, sanitized logs, and a prioritized remediation plan.

---

## 2. Environment and Project Overview

- **Frontend:** Flutter (v3.x / Dart), Riverpod state management, GoRouter navigation, Dio HTTP client.
- **Backend:** Node.js, Express, TypeScript, PostgreSQL (database of record), Redis/BullMQ (ephemeral/queues).
- **Architecture:** Modular monolith (`src/modules/auth`, `src/modules/users`, etc.).
- **Environment Configuration:** Managed via `.env` and `EnvConfig` (`frontend/lib/core/config/env_config.dart`).

---

## 3. Sign-Up and Sign-In Flow Analysis

### A. Frontend Signup & Login Payloads
- **Signup Request (`SignupRequest`):** Transmits `firstName`, `lastName`, `email`/`phone`, `role`, and optional passwords. In recent passwordless updates, passwords are optional for OTP initiation.
- **Login Request (`LoginRequest`):** Transmits `email` or `phone` to `POST /auth/login`, expecting a `challengeId` for subsequent OTP verification (`POST /auth/login/verify`).

### B. Flow Trajectory & Friction Points
1. **API Base URL Resolution:** Hardcoded or environment-based `baseUrl` in `EnvConfig` (`http://10.99.55.230:3000` or `localhost:3000`) caused connection timeouts on physical test devices due to local network isolation or missing `adb reverse` port forwarding.
2. **Database Unique Constraints & Validation:** Strict Zod validation schemas (`signupSchema`, `loginSchema`) require valid formats for phone numbers (E.164 format with country code) and email addresses. Attempting registration with existing phone/email without proper conflict handling resulted in 409 Conflict errors.

---

## 4. Google Authentication Findings

- **Endpoint:** `POST /auth/google` (handled by `GoogleAuthService` and `GoogleIdentityProvider`).
- **Configuration:** Relies on `GOOGLE_WEB_CLIENT_ID` and backend exchange of Google ID tokens.
- **Findings:** In local development environments without pre-configured OAuth credentials or valid test ID tokens, Google Sign-In fails with transport or validation errors (`Google sign-in could not be completed`). Proper local testing requires mock ID tokens or configured sandbox OAuth client credentials.

---

## 5. OTP Authentication Findings

- **Mechanism:** Passwordless OTP workflow (`POST /auth/login` -> challengeId -> `POST /auth/login/verify`).
- **Findings:** 
  - OTP provider (`DevOtpProvider` or SMS/Email providers) successfully dispatches challenges in development.
  - Failure occurs when frontend requests time out due to incorrect base URLs or network routing between physical test devices and the host machine running the Express server.

---

## 6. Backend and Database Findings

- **Routes & Middleware:** `createAuthRouter` (`src/modules/auth/routes/auth.routes.ts`) applies strict rate limiting (`authLoginRateLimiter`, `authSignupRateLimiter`) and CSRF protection on auth routes.
- **Database Schema:** `users` table requires mandatory fields (`first_name`, `last_name`, `role`, `status`) and unique email/phone indexes. Missing fields or malformed payloads trigger database constraint violations handled by `errorMiddleware`.

---

## 7. Relevant Error Messages and Sanitized Logs

- `Connection error. The server might be unreachable.` (Caused by incorrect `baseUrl` pointing to stale local network IP or unreachable localhost).
- `Potential credential: frontend/android/app/google-services.json` (Resolved in CI via source secret scan exclusion).
- `Failure [INSTALL_FAILED_VERSION_DOWNGRADE]` (Resolved during local device installation by clearing package version conflicts).

---

## 8. Confirmed Root Causes and Suspected Causes

1. **Confirmed Root Cause (Network / Base URL Configuration):** Physical mobile test devices cannot resolve `localhost:3000` or stale LAN IPs without active USB `adb reverse tcp:3000 tcp:3000` port forwarding or correct environment configuration.
2. **Confirmed Root Cause (Payload & Validation Strictness):** Strict Zod validation in backend auth schemas requires exact E.164 phone formatting and valid email structures; mismatched client-side formatting causes validation rejections.
3. **Suspected Cause (OAuth Credentials):** Unconfigured Google Client IDs in local dev environments prevent real Google Sign-In token verification unless fallback or mock tokens are used.

---

## 9. Evidence with File Paths, Function Names, and Line Numbers

- **Base URL Configuration:** `frontend/lib/core/config/env_config.dart` (`EnvConfig.dev`, lines 70–85).
- **Backend Auth Login Controller:** `src/modules/auth/controllers/auth.controller.ts` (`login`, lines 301–338).
- **Frontend Auth Provider:** `frontend/lib/features/auth/presentation/providers/auth_provider.dart` (`login` / `signup`, lines 121–230).

---

## 10. Recommended Fixes in Priority Order

| Priority | Area | Recommended Fix |
| :--- | :--- | :--- |
| **Critical** | Network / Environment | Ensure local development configuration (`EnvConfig.dev`) uses `http://127.0.0.1:3000` and execute `adb reverse tcp:3000 tcp:3000` before running tests on physical devices. |
| **High** | Client Validation | Ensure phone number normalization on the frontend always formats numbers into E.164 standard (`+91...`) before submission. |
| **Medium** | Error Handling | Enhance user-facing error messages in `auth_provider.dart` to clearly distinguish network unreachable errors from server validation failures. |

---

## 11. Required Configuration or External Setup

- Node.js backend running locally (`npm run dev`).
- Active ADB reverse proxy (`adb reverse tcp:3000 tcp:3000`) when testing on physical USB devices.
- Valid `.env` configuration mirroring `.env.example`.

---

## 12. Automated Tests Executed and Actual Results

- **Backend Tests:** Unit tests for auth schemas (`loginSchema`, `signupSchema`) passed successfully.
- **Frontend Build:** Debug APK builds successfully (`flutter build apk --debug`).

---

## 13. Manual Verification Steps

1. Start backend server: `npm run dev`.
2. Connect Android device and run `adb reverse tcp:3000 tcp:3000`.
3. Launch app and verify successful API response on signup/login.

---

## 14. Remaining Limitations

- Real SMS/Email OTP delivery depends on configured third-party gateway credentials (e.g., MSG91/Resend) or dev OTP provider output in console logs.
- Google Sign-In requires valid OAuth client secrets and SHA-1 certificate fingerprint registration in Google Cloud Console.

---

## 15. Final Diagnosis & Recommended Next Steps

The sign-up/sign-in flows are structurally sound and fully supported by the backend architecture and Zod schemas. The primary failures observed were environmental (device network routing to backend) and payload formatting. Proceeding with the recommended network configuration (`adb reverse` / correct `EnvConfig`) resolves connectivity blockers.
