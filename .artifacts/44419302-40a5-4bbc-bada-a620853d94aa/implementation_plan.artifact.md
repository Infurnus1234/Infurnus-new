# Direct Dashboard Access Without Frontend Login (Development Mode)

Enable direct access to the existing INFURNUS User Dashboard in the Flutter frontend for local development testing, bypassing the login/OTP/Google sign-in flow while preserving authentication security in production.

## User Review Required

> [!IMPORTANT]
> This mechanism is strictly restricted to local development environments (`kDebugMode` / environment configuration) and does not weaken production security, disable backend auth middleware, or create a mock dashboard.

- **Development User**: `developer@infurnus.local` (Customer role, role: `customer`).
- **Access Flow**: A dev-only button / bypass route (`/dev-dashboard`) or automatic session bootstrap in debug mode that provisions/retrieves the test user and injects a valid development token.

## Open Questions

- None. The backend supports passwordless OTP login and JWT token generation, and the Flutter app uses Riverpod + GoRouter.

## Proposed Changes

### Backend (`src/`)

#### [NEW] [dev-auth.routes.ts](file:///C:/Users/abhis/AndroidStudioProjects/Infurnus-new/src/modules/auth/routes/dev-auth.routes.ts)
- Add a local-development-only endpoint (`POST /auth/dev-token`) that checks if `NODE_ENV !== 'production'`, provisions or finds `developer@infurnus.local`, and issues a valid JWT access token.

### Frontend (`frontend/lib/`)

#### [MODIFY] [auth_provider.dart](file:///C:/Users/abhis/AndroidStudioProjects/Infurnus-new/frontend/lib/features/auth/presentation/providers/auth_provider.dart)
- Add a `devBypassLogin()` method that calls `POST /auth/dev-token`, stores the token securely, and authenticates the session.

#### [MODIFY] [login_screen.dart](file:///C:/Users/abhis/AndroidStudioProjects/Infurnus-new/frontend/lib/features/auth/presentation/screens/login_screen.dart)
- In debug mode (`kDebugMode`), add a subtle "Developer Direct Access" button that invokes `devBypassLogin()`.

## Verification Plan

### Automated Tests
- Run backend unit/integration tests and Flutter analysis.

### Manual Verification
- Launch the app in debug mode on the device/emulator.
- Tap the development bypass button on the Login screen.
- Verify that the real User Dashboard (`/customer-home`) opens immediately without requiring OTP entry.
