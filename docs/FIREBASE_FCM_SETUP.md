# INFURNUS Firebase / FCM setup for the owner

This is a setup guide, not evidence that a live device received a push. The Driver App is a separate owner project; no Driver App source, build, repository or design is changed by this backend task.

## 1. Account and project choice

Use a regular Google account that is authorized to own or administer the Firebase project. An existing Google account is sufficient; a separate Firebase-specific email is not required. Prefer project ownership controlled by the business, with named access for developers rather than shared passwords. Someone with appropriate project IAM access must grant the backend sending identity permission. Do not create another project until you have checked which existing project you own and intend to use. See [Firebase project management](https://firebase.google.com/docs/projects/learn-more).

Two different IDs were discovered:

| Evidence                                                         | ID                  | Meaning                                                                                                        |
| ---------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Customer Firebase config in GitHub main                          | `infurnus-299d7`    | Existing client config names this Firebase project; ownership and current console configuration are unverified |
| Existing backend deployment documentation / local gcloud project | `infurnus-5c47c`    | Backend hosting project; current cloud metadata reads require reauthentication                                 |
| Backend local FIREBASE_PROJECT_ID                                | example placeholder | Does not identify a usable configured sending project                                                          |

Do not substitute the hosting project ID for the Firebase token project without checking. FCM tokens must be sent through their intended Firebase project. Different hosting and Firebase projects are possible when the sending identity has the required target-project permissions. Reuse `infurnus-299d7` only if the owner confirms access and intends to keep that client project; otherwise plan the mobile configuration change explicitly.

FCM is listed among Firebase's no-cost products. A new paid Google Cloud account is not required solely to send FCM notifications. Hosting this existing backend, continuously running its worker and operating Redis/PostgreSQL may have their own charges; Firebase's free FCM service does not make that infrastructure free. Billing status on the existing deployment was not verified. [Firebase pricing](https://firebase.google.com/pricing), [Firebase billing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## 2. Create or reuse the authorized Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) with the authorized Google account.
2. Find the intended existing project, or create/add Firebase to an authorized Google Cloud project if none is appropriate.
3. In Project settings, confirm the actual **project ID**. Display names, OAuth client IDs and project numbers are different values.
4. Confirm the **Firebase Cloud Messaging API** (`fcm.googleapis.com`) is enabled for the sending project. Use current Admin SDK / HTTP v1 configuration, not a legacy server key.
5. Register each applicable Android application with its exact `applicationId` and download its own `google-services.json`.
6. Register an Apple app only if iOS is required, with its exact bundle ID, and configure its APNs credentials.

The discovered customer Android ID is `com.infurnus.app`. Historical backend handoff records name the previous driver Android ID `com.infurnus.driver.infurnus_driver`. The owner is replacing that Driver App, so the new app's final Android ID must be confirmed by its developer; this audit does not assume the historical ID will remain. The future iOS bundle ID is not confirmed. A single authorized Firebase project can register multiple applications; each needs the matching client configuration. [Android setup](https://firebase.google.com/docs/android/setup), [FCM Flutter setup](https://firebase.google.com/docs/cloud-messaging/flutter/get-started).

FCM does not itself require adding Firestore, Firebase Storage or Firebase Authentication to this custom-JWT backend. Google Sign-in OAuth configuration and Firebase push configuration are separate concerns; a working Google sign-in does not establish FCM readiness. Analytics is optional for basic push delivery.

## 3. Backend credentials supported by this merged code

The existing implementation explicitly uses `firebase-admin` with `cert(...)` and the following three environment variables together:

| Variable                | Required value                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`   | Actual Firebase sending project ID matching the registered device's Firebase project  |
| `FIREBASE_CLIENT_EMAIL` | Authorized sending service account's client email                                     |
| `FIREBASE_PRIVATE_KEY`  | Its matching private key, supplied securely; actual or escaped newlines are supported |

All three must be present together. The API environment schema rejects partial configuration. The notification worker additionally requires `REDIS_URL`. Existing database/JWT/OTP encryption configuration remains required by the backend; Firebase does not replace it.

Check for an already authorized service account before generating any new key. If a key-based deployment is selected and a key is genuinely needed, an authorized administrator can obtain it through Project settings / Service accounts or Google Cloud IAM. Do not paste the key, service-account JSON or refresh tokens into chat. Do not commit them, put them in Flutter assets, or include them in a mobile APK.

For local development, keep credential values in an ignored local environment or a secure process environment. This code reads the split variables above; setting only `GOOGLE_APPLICATION_CREDENTIALS` to a JSON path is **not** a supported substitute in the current implementation. Do not make a real notification send merely to test malformed credentials.

For deployment, configure sensitive values through the platform's secret injection mechanism, such as Secret Manager references, using a dedicated worker identity. The runtime identity needs access to only its required secrets and the sending account needs target-project FCM permission. Avoid embedding secrets in images, source archives, build arguments, shell history or logs. [Admin SDK setup](https://firebase.google.com/docs/admin/setup).

The required sending permission is `cloudmessaging.messages.create`; the predefined **Firebase Cloud Messaging API Admin** role is `roles/firebasecloudmessaging.admin`. Grant a sending identity the appropriate permission on the target Firebase project, rather than granting project Owner merely for sending. Cross-project service-account sending needs explicit target-project access. [FCM IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging), [Firebase permissions](https://firebase.google.com/docs/projects/iam/permissions).

Cloud Run supports keyless runtime identities/ADC, and workload identity can also avoid stored keys for other runtimes. This merged code still selects explicit certificates; a future ADC option must update both initialization and the all-three-variable validation/worker startup guard. Do not assume ADC works just because the deployment runs on Google Cloud. Keyless support is a prioritized backend/deployment improvement, not a completed feature.

## 4. Start and operate the actual worker

The API image's default command runs `dist/server.js`. It does **not** start the notification consumer automatically. Build the backend, then run its existing dedicated worker entry point:

```text
npm run build
npm run worker:notifications
```

The production command uses compiled JavaScript, so it works without the dev-only `tsx` package. Local development may use `npm run worker:notifications:dev`. Both worker filenames resolve to the same implementation; do not deploy the old provider-acceptance-as-DELIVERED implementation.

| Variable                                                               | Default / requirement                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `REDIS_URL`                                                            | Required authenticated reachable Redis URL; use TLS where required by the provider |
| `NOTIFICATION_QUEUE_NAME`                                              | `infurnus-notifications`; API and worker must use the same queue name and Redis    |
| `NOTIFICATION_MAX_ATTEMPTS`                                            | `5`                                                                                |
| `NOTIFICATION_BACKOFF_DELAY_MS`                                        | `5000`, exponential backoff                                                        |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Valid matching sending configuration, not example values                           |
| `DATABASE_URL`                                                         | Same intended backend database as the API                                          |

Operate the long-running BullMQ worker on infrastructure that actually supplies background CPU and prevents unintended scale-to-zero. For Cloud Run, use an appropriate worker pool or deliberately configured instance-based CPU/minimum-instance service; an ordinary request-only API container is not proof that a worker runs continuously. Inspect reachability to Redis and PostgreSQL and monitor failed jobs and worker restarts. No such deployment was performed or verified here. [Cloud Run billing / CPU allocation](https://docs.cloud.google.com/run/docs/configuring/billing-settings).

## 5. Requirements for the owner's future mobile implementation

These are integration requirements only, not Driver App implementation work:

- Use Firebase configuration for the exact package/bundle ID and chosen project. Integrate `firebase_core` and `firebase_messaging` as appropriate to the new app.
- Request notification permission at an appropriate time, including Android 13+ and Apple permission handling. Denied permission is not a successful visible-push test.
- Retrieve an FCM token and subscribe to token refresh. After backend authentication, register the current token through the authenticated device API below. Never log tokens or use a hardcoded test token in production.
- Create Android notification channel **`infurnus_driver_channel`**, matching the backend payload, with suitable ride-alert settings.
- Handle foreground messages explicitly. Register the supported background handler; Flutter background entry points must survive release tree shaking.
- Handle notification taps from both background and normal terminated state. Read `notificationId`, `type`, `rideId` and, for an offer, `expiresAt`; then fetch the current authorized ride from the backend. A push must never itself approve a driver or accept/start a ride.
- On logout, deregister that installation's device row before clearing authentication. On account change, register under the newly authenticated account and check old-account delivery stops. Backend refresh-token logout currently does not itself deactivate every device token.
- For iOS only, configure the authorized Apple developer team, APNs authentication key/certificate, application capabilities and bundle ID in Firebase. APNs credentials are not the backend Firebase service-account key.
- Test on a real supported device in foreground, background and normal terminated states. OS force-stop, permission denial, battery restrictions and offline/expired offers must be documented separately; delivery cannot be guaranteed merely from an API acceptance response.

[Flutter message reception](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages), [Flutter FCM setup and APNs](https://firebase.google.com/docs/cloud-messaging/flutter/get-started).

## 6. Existing backend mobile contracts

All device operations require the user's backend bearer access token; the controller derives ownership from authentication.

```text
POST   /notifications/devices
GET    /notifications/devices
PATCH  /notifications/devices/:deviceId
DELETE /notifications/devices/:deviceId
```

Register body:

```json
{
  "fcmToken": "TOKEN_RETRIEVED_ON_THE_DEVICE",
  "platform": "ANDROID",
  "deviceId": "STABLE_INSTALLATION_IDENTIFIER"
}
```

The returned `id` is the row UUID used in PATCH/DELETE paths; it is different from the installation identifier in the request. Rotation can update `fcmToken`; registering the same authenticated user and installation updates its existing record. Supported platform values are `ANDROID`, `IOS`, `WEB`.

The authenticated inbox is `GET /notifications/inbox?limit=25&offset=0`, with `PATCH /notifications/inbox/:id/read` and `PATCH /notifications/inbox/read-all`. Reading an inbox entry does not prove background push receipt. User push preference is available through the owner-only `GET/PATCH /users/:id/preferences` using `pushNotificationsEnabled`.

## 7. Required owner actions versus optional work

Required: authorized Google/Firebase project access; a deliberate Firebase project choice; the future Driver App's final application ID; valid backend sending credentials using the supported method; target-project FCM permission/API enablement; a deployed continuous worker with reachable Redis/PostgreSQL; a registered authorized dedicated test device/token; and the future mobile handlers/permissions/channel.

Optional or conditional: a separate business Google account, a new Firebase project, Analytics, web VAPID configuration, iOS/APNs if iOS is supported, and keyless ADC/workload-identity support after the backend is extended to select it.

Live cloud inspection currently needs owner reauthentication of the existing Google Cloud session. Use the normal local Google Cloud sign-in flow; do not send passwords, OTPs, refresh tokens or keys in chat. Reauthenticate ADC separately if that is the mechanism used for read-only deployment inspection.
