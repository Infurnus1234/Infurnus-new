# INFURNUS — Production Readiness & Operations Guide

This document defines the operational baseline, environment configuration, build and deployment procedures, security verification, and manual real-world testing matrix for the INFURNUS multi-sector platform.

---

## 1. Required Environment Variables

All variables must be configured via environment variables or a secured, non-committed `.env` file on the deployment host.

### Backend Environment Variables

| Variable                        | Type / Constraints                                   | Default / Example                         | Purpose                                                                                                             |
| :------------------------------ | :--------------------------------------------------- | :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                      | `development` \| `staging` \| `production` \| `test` | `development`                             | Operating environment mode. In `production`, strict validation enforces non-placeholder secrets and secure cookies. |
| `PORT`                          | Integer > 0                                          | `3000`                                    | HTTP and WebSocket server listening port.                                                                           |
| `DATABASE_URL`                  | PostgreSQL Connection URI                            | `postgresql://user:pass@host:5432/dbname` | Connection string to PostgreSQL instance with PostGIS extension.                                                    |
| `CORS_ORIGIN`                   | Comma-separated URL list                             | `http://localhost:5173`                   | Allowed origins for cross-origin browser requests (e.g. `https://infurnus.com,https://admin.infurnus.com`).         |
| `CORS_CREDENTIALS`              | Boolean                                              | `true`                                    | Allows cookies and credentials over CORS.                                                                           |
| `JWT_ACCESS_SECRET`             | String (>= 32 chars)                                 | N/A (Required)                            | Secret key used to sign and verify short-lived access JWTs. Must not use placeholder in production.                 |
| `JWT_ACCESS_PREVIOUS_SECRET`    | String (>= 32 chars)                                 | Optional                                  | Previous key for zero-downtime key rotation.                                                                        |
| `JWT_ACCESS_EXPIRES_IN`         | Duration string                                      | `15m`                                     | Access token lifespan.                                                                                              |
| `JWT_REFRESH_EXPIRES_IN`        | Duration string                                      | `30d`                                     | Refresh token lifespan.                                                                                             |
| `AUTH_REFRESH_COOKIE_NAME`      | String                                               | `infurnus_refresh_token`                  | HTTP-only cookie name for refresh tokens.                                                                           |
| `AUTH_REFRESH_COOKIE_SECURE`    | Boolean                                              | `true` (prod) / `false` (dev)             | Enforces HTTPS-only cookies in production.                                                                          |
| `AUTH_REFRESH_COOKIE_SAME_SITE` | `strict` \| `lax` \| `none`                          | `strict`                                  | CSRF cookie defense policy.                                                                                         |
| `AUTH_CSRF_COOKIE_NAME`         | String                                               | `infurnus_csrf_token`                     | Anti-CSRF double-submit token cookie name.                                                                          |
| `AUTH_CSRF_COOKIE_SECURE`       | Boolean                                              | `true` (prod) / `false` (dev)             | Enforces HTTPS-only for CSRF cookies in production.                                                                 |
| `AUTH_CSRF_COOKIE_SAME_SITE`    | `strict` \| `lax` \| `none`                          | `strict`                                  | CSRF defense policy.                                                                                                |
| `AUTH_OTP_ENCRYPTION_KEY`       | Base64-encoded 32-byte key                           | N/A (Required)                            | AES-256-GCM symmetric key used to encrypt login and signup OTP challenges.                                          |
| `AUTH_RATE_LIMIT_ENABLED`       | Boolean                                              | `true` (prod) / `false` (dev)             | Master switch for Express IP-based rate limiting.                                                                   |
| `CASHFREE_ENV`                  | `sandbox` \| `production`                            | `sandbox`                                 | Cashfree gateway operating environment.                                                                             |
| `CASHFREE_CLIENT_ID`            | String                                               | N/A                                       | Cashfree App ID. Required when `CASHFREE_ENV=production`.                                                           |
| `CASHFREE_CLIENT_SECRET`        | String                                               | N/A                                       | Cashfree Secret Key. Required when `CASHFREE_ENV=production`.                                                       |
| `CASHFREE_API_VERSION`          | String                                               | `2023-08-01`                              | Cashfree REST API contract version.                                                                                 |
| `CASHFREE_BASE_URL`             | URL                                                  | `https://sandbox.cashfree.com/pg`         | API base endpoint (`https://api.cashfree.com/pg` for production).                                                   |
| `GOOGLE_MAPS_API_KEY`           | String                                               | Optional                                  | Server-side Google Maps Directions & Distance Matrix key.                                                           |

### Frontend Build Variables (`--dart-define`)

| Define Flag    | Allowed Values                       | Default                       | Purpose                                                         |
| :------------- | :----------------------------------- | :---------------------------- | :-------------------------------------------------------------- |
| `ENVIRONMENT`  | `dev`, `staging`, `prod`, `emulator` | `prod` (in release)           | Selects runtime environment endpoints and Cashfree environment. |
| `API_URL`      | HTTPS URL                            | `https://api.infurnus.com`    | Override for API and WebSocket endpoint.                        |
| `SOCKET_URL`   | WSS URL                              | Defaults to `API_URL`         | Explicit WebSocket base URL if different from HTTP API.         |
| `MAPS_API_KEY` | String                               | Gradle / Manifest placeholder | Google Maps Android SDK client key.                             |

---

## 2. Environment Separation

| Parameter                 | Development                       | Staging / Sandbox                  | Production                    |
| :------------------------ | :-------------------------------- | :--------------------------------- | :---------------------------- |
| **`NODE_ENV`**            | `development`                     | `staging`                          | `production`                  |
| **`CASHFREE_ENV`**        | `sandbox`                         | `sandbox`                          | `production`                  |
| **Cashfree Endpoint**     | `https://sandbox.cashfree.com/pg` | `https://sandbox.cashfree.com/pg`  | `https://api.cashfree.com/pg` |
| **Cashfree Webhook HMAC** | Sandbox Secret                    | Sandbox Secret                     | Production Secret             |
| **Backend Cookie Secure** | `false` (HTTP)                    | `true` (HTTPS)                     | `true` (Strict HTTPS)         |
| **Flutter Base URL**      | `http://10.0.2.2:3000`            | `https://staging-api.infurnus.com` | `https://api.infurnus.com`    |
| **Rate Limiting**         | Optional (`false`)                | Enforced (`true`)                  | Enforced (`true`)             |
| **Database Pool**         | 10 connections                    | 20 connections                     | 20–50 connections             |

---

## 3. Database Migration Process

The backend utilizes deterministic SQL migrations tracked in the `schema_migrations` table with PostgreSQL advisory locks (`248173901`) to prevent concurrent execution conflicts during horizontal scaling.

### Migration Commands

```bash
# Run pending migrations against target DATABASE_URL
npm run migrate

# Baseline an existing database schema that already has early tables
npm run migrate:baseline

# Execute clean-instance migration verification (automated test database)
npm run test:migrations
```

### Production Migration Safety Guidelines

1. **Never drop tables or columns** without an advance two-phase deprecation cycle.
2. **Always back up** the production database before executing migrations.
3. PostGIS (`postgis`) extension is mandatory.
4. Migrations run within transactions per file; a failing migration rolls back cleanly without leaving partial tables.

---

## 4. Backend Startup Process

### Production Startup (Node.js)

```bash
# 1. Install production dependencies only
npm ci --omit=dev --ignore-scripts
npm rebuild argon2

# 2. Compile TypeScript
npm run build

# 3. Apply schema migrations
npm run migrate

# 4. Start production server
NODE_ENV=production node dist/server.js
```

### Docker Startup

```bash
# Build multi-stage optimized production image
docker build -t infurnus-backend:latest .

# Run container
docker run -d \
  --name infurnus-api \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_ACCESS_SECRET="..." \
  -e AUTH_OTP_ENCRYPTION_KEY="..." \
  -e CASHFREE_ENV="production" \
  -e CASHFREE_CLIENT_ID="..." \
  -e CASHFREE_CLIENT_SECRET="..." \
  infurnus-backend:latest
```

---

## 5. Flutter Release Build Process

### Prerequisites

- Flutter SDK (stable, >= 3.13.3)
- Android SDK with platform tools and Java 17

### Build Commands

```bash
cd frontend

# Clean previous build artifacts
flutter clean

# Fetch dependencies
flutter pub get

# Static analysis and test suite verification
flutter analyze
flutter test

# Production APK Build (with compile-time environment flags)
flutter build apk --release \
  --dart-define=ENVIRONMENT=prod \
  --dart-define=API_URL=https://api.infurnus.com

# Production App Bundle for Google Play Store
flutter build appbundle --release \
  --dart-define=ENVIRONMENT=prod \
  --dart-define=API_URL=https://api.infurnus.com
```

Output path: `frontend/build/app/outputs/flutter-apk/app-release.apk`

---

## 6. Cashfree Production Activation Checklist

> [!CAUTION]
> Do NOT switch to production until all merchant KYC steps and webhooks are active.

- [ ] Complete Cashfree Merchant Onboarding & KYC verification on the Cashfree Merchant Dashboard.
- [ ] Generate Production API Keys from **Cashfree Dashboard > Developers > API Keys**:
  - `App ID` (`CASHFREE_CLIENT_ID`)
  - `Secret Key` (`CASHFREE_CLIENT_SECRET`)
- [ ] Set `CASHFREE_ENV=production` in production environment.
- [ ] Set `CASHFREE_BASE_URL=https://api.cashfree.com/pg`.
- [ ] Confirm backend fails closed if credentials are missing or set to sandbox when `CASHFREE_ENV=production`.
- [ ] Execute single ₹1 test transaction in production and verify complete lifecycle (Initiation -> Capture -> Server Reconciliation).

---

## 7. Cashfree Webhook Registration

Cashfree sends real-time payment notifications via HTTP POST to the backend webhook endpoint.

1. **Webhook URL**: `https://api.infurnus.com/payments/webhooks/cashfree`
2. **Events to Subscribe**:
   - `PAYMENT_SUCCESS_WEBHOOK`
   - `PAYMENT_FAILED_WEBHOOK`
   - `PAYMENT_USER_DROPPED_WEBHOOK`
3. **Security & Signature Verification**:
   - The backend computes HMAC-SHA256 signature over `${x-webhook-timestamp}${rawBody}` using `CASHFREE_CLIENT_SECRET`.
   - Any signature mismatch returns `401 Unauthorized`.
   - Unhandled duplicate webhooks are idempotent and return `200 OK` without triggering repeated database state transitions.

---

## 8. Google Maps Configuration

### Server-Side (Backend)

- Pass `GOOGLE_MAPS_API_KEY` with access to:
  - Directions API
  - Distance Matrix API
  - Places API (New)
- Recalculation engine falls back gracefully to Haversine calculations if the Google Maps API key is omitted or quotas are exceeded.

### Client-Side (Android)

- Set `MAPS_API_KEY` in `frontend/android/local.properties`:
  ```properties
  MAPS_API_KEY=AIzaSy...
  ```
- Or pass during Gradle build:
  ```bash
  flutter build apk --release -P MAPS_API_KEY=AIzaSy...
  ```

---

## 9. Health & Observability Checks

### Liveness Probe

- **Endpoint**: `GET /health`
- **Response**: HTTP 200
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "uptime": 1240
    }
  }
  ```

### Readiness Probe

- **Endpoint**: `GET /health/ready` (or `GET /ready`)
- **Healthy Response**: HTTP 200
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "ready": true,
      "database": "connected"
    }
  }
  ```
- **Unhealthy Response**: HTTP 503
  ```json
  {
    "success": false,
    "error": {
      "code": "SERVICE_UNAVAILABLE",
      "message": "Database connection check failed"
    }
  }
  ```

---

## 10. Security Checklist

- [x] **Zero Secrets in Source**: No API keys, database passwords, or JWT secrets in Git or Flutter client code.
- [x] **CORS Allowlist**: Express CORS configured strictly to allowed origins rather than unrestricted `*`.
- [x] **Request Body Protection**: Express JSON body size restricted to 1MB; oversized requests rejected with HTTP 413.
- [x] **Raw Body Preservation**: Preserves untouched byte buffer for Cashfree HMAC signature verification.
- [x] **Server-Authoritative Pricing**: Fares and payment amounts are calculated on the backend; client-supplied amounts are ignored.
- [x] **Role-Based Access Control (RBAC)**: Strict separation between `customer`, `driver`, `fleet_owner`, and `admin`.
- [x] **Refund Authorization**: Refunds restricted strictly to `admin` / `super_admin` roles.
- [x] **Zero PIN Exposure**: Customer 4-digit ride verification PIN is never sent to the driver client; verified only server-side.
- [x] **Error Sanitization**: Production API responses return generic error messages; stack traces and SQL queries are never exposed.

---

## 11. Real-Device Manual Test Matrix

### Sector 1: Passenger Vehicle Test Flow

1. **Customer Login**: Enter phone number, receive and verify OTP, verify JWT issuance.
2. **Home & Sector Selection**: Select "Passenger" sector, verify available categories (Bike, Auto, Hatchback, Sedan, SUV).
3. **Pickup & Destination**: Set pickup and drop locations on interactive map, confirm geocoded addresses.
4. **Fare Estimate**: Verify itemized fare estimate (base fare, distance rate, time rate).
5. **Ride Creation**: Submit booking request; verify state becomes `requested`.
6. **Driver Matching**: Driver device in "Passenger" sector receives socket dispatch.
7. **Driver Acceptance**: Driver accepts; state transitions to `driver_assigned`.
8. **Driver En Route & Arrival**: Driver taps "Arrived"; state transitions to `driver_arrived`.
9. **Customer PIN Display**: Customer app displays 4-digit verification PIN.
10. **Driver Enters PIN**: Driver enters PIN; backend verifies; ride transitions to `in_progress`.
11. **Live Ride & Tracking**: Location updates stream across WebSocket; map polyline updates.
12. **Ride Completion**: Driver taps "Complete"; ride transitions to `completed`.
13. **Payment**: Initiate payment; checkout via Cashfree PG; server confirms `CAPTURED`.
14. **Rating**: Customer rates driver; rating stored.
15. **History**: Verify completed ride appears in customer booking history.

### Sector 2: Logistics Test Flow

1. **Category Selection**: Select "Logistics" on customer home screen.
2. **Cargo Details**: Select goods category (Electronics, Furniture, etc.), input weight (kg), and quantity.
3. **Helper / Loading Assistance**: Toggle helper option; verify fare dynamically updates.
4. **Driver Dispatch**: Incoming ride request on driver app displays cargo specifications.
5. **Pickup & Delivery**: Verify PIN verification flow and successful delivery completion.
6. **Payment & History**: Verify final fare matches server itemization with cargo surcharge.

### Sector 3: Service Vehicle Test Flow

1. **Specialized Vehicle Selection**: Select Ambulance, Towing, JCB, Recovery, or Roadside Service.
2. **Pickup & Incident Location**: Select location requiring service.
3. **Fare Structure**: Verify fixed call-out / trip rate without hourly rental pollution.
4. **Service Execution**: Driver accepts, navigates to scene, verifies arrival, and completes service.
5. **Payment**: Process payment and verify record in service history.

### Sector 4: Premium Vehicle Test Flow

1. **Vehicle Selection**: Select Premium sector, choose luxury fleet vehicle.
2. **Schedule & Duration**: Select booking date, start time, and standby package hours.
3. **Trip Start**: Start ride with strict PIN verification.
4. **GPS Breadcrumbs**: Driver device reports GPS breadcrumbs during trip.
5. **Server Reconciliation**: Backend accumulates actual distance and computes authoritative fuel cost.
6. **Trip Finalization**: Complete ride; verify final fare reflects `baseFare + actualDistance * rate + actualFuelCost`.
7. **Payment**: Pay finalized fare via Cashfree; verify server capture.

### Driver Device Test Flow

1. **Onboarding & Verification**: Complete profile registration, upload documents (DL, RC, Insurance).
2. **Availability Toggle**: Switch status from Offline to Online; verify spatial index updates.
3. **Incoming Request Card**: Receive audio/visual dispatch; review trip details and timer.
4. **Accept & Navigate**: Accept trip; initiate turn-by-turn routing to pickup.
5. **Arrive & Enter PIN**: Tap "Arrived at Pickup", prompt customer for PIN, submit verification.
6. **Trip Completion**: Mark trip complete; verify payout/earnings update in driver financials screen.

---

## 12. Rollback Considerations

1. **Database Rollbacks**:
   - Schema migrations are additive wherever possible.
   - If a deployment must be rolled back, revert backend code to previous release tag.
   - Do not drop new columns unless strictly necessary, as old code ignores unknown columns.
2. **API Traffic Routing**:
   - Utilize blue/green or rolling container updates behind a load balancer (Nginx / ALB).
   - If `/health/ready` fails on new containers, traffic routing remains on healthy existing instances.
3. **Flutter Client Rollback**:
   - Mobile app releases cannot be instantaneously rolled back from app stores.
   - Backward-compatible API versioning must be preserved for at least 2 previous client versions.

---

## 13. Known Limitations & Recommendations

1. **Load Testing**: Local vitest concurrency tests verified 50+ concurrent socket connections. Enterprise-scale load testing (10,000+ simultaneous rides) should be executed in a dedicated staging load environment.
2. **SMS Gateway Fallback**: In development, `DevOtpProvider` logs OTPs to terminal. In staging/production, `SENDMATOR_API_KEY` is required for real SMS delivery.
3. **Google Maps Quotas**: Route recalculation incorporates exponential backoff and Haversine distance fallbacks if Google Maps API limits are encountered.
