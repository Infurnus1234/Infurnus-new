# Admin integration and coordinated release

The Super Admin can create an Admin through the existing authenticated session, using name, normalized email and an Argon2 password. New Admins receive no permissions unless explicitly selected. No Super Admin creation or public signup was added.

Permissions are stored in the existing migration 038 tables and checked from the database on every administrative API request. Supported read, detail, document, sensitive-data and mutation grants are distinct. Unknown administrative operations default to denial. Server page guards and visible controls reflect saved grants, while backend checks remain authoritative. Permission updates require an exact version, reject stale edits and preserve audit history. Shared managed roles cannot be silently changed for another user. Scoped Admin accounts fail closed until resource query filtering is implemented.

Dashboard links, native vehicle create/edit/deactivate flows, approval and pricing controls use existing APIs. The map uses Google Maps and only coordinates marked fresh by the database (30 seconds). Empty or stale fleet data produces no invented markers. The full-page map provides refresh, pagination and return navigation. Private driver profile photos use native uploaded document metadata and the authenticated document proxy, including lowercase native profile_photo records.

## Permission matrix

| Capability                                         | Required Admin grants                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Dashboard                                          | dashboard.read                                                                         |
| User list/detail/status/contact                    | users.read / users.detail / users.update / users.sensitive                             |
| Driver list/detail/documents/contact/verify        | drivers.read / drivers.detail / drivers.documents / drivers.sensitive / drivers.verify |
| Partner list/detail/documents/contact              | partners.read / partners.detail / partners.documents / partners.sensitive              |
| Vehicles list/detail/create/edit/deactivate/verify | vehicles.read plus applicable detail/create/update/deactivate/verify                   |
| Approval list/detail/documents/contact/decision    | approvals.read plus detail/documents/sensitive/approve/reject                          |
| Pricing                                            | pricing.read plus create/update                                                        |
| Fleet map                                          | fleet.read; native map route/geocode also maps.read                                    |
| Operations                                         | matching resource.read; coupons/support require separate create/update                 |
| Reports                                            | reports.read                                                                           |
| Admin creation and grant management                | active Super Admin only                                                                |

Actual route combinations are specified in backend permission-policy.ts. Super Admin status is checked live; an old token cannot preserve a removed Super Admin role. Existing customer, driver and partner ownership middleware remains in force.

## Verification limits and remaining work

Local tests cover real PostgreSQL persistence and native HTTP routes. Media tests replace only external storage with a labelled local PNG adapter: they do not verify live Cloudinary. The browser map showed the real basemap and an empty fleet, not a production vehicle. Geographic scopes, unavailable settings, vendor/net-revenue definitions and incomplete FTL quote policy remain unresolved capabilities. No fake metrics, locations or prices were introduced.

## Release requiring approval

1. Keep the existing Cloud Run service infurnus-api in infurnus-5c47c / asia-south2, existing Cloud SQL infurnusdb, storage, Maps, environment secrets, CORS and pricing. Verify migration 038 tables before release; this change adds no migration.
2. Record the current backend image/revision and frontend deployment for rollback. Current audited traffic is infurnus-api-release-20261014-live, image sha256:d20daa43476f5d3553c2cade3afbdfbab860fb431a405ce37f001a89f597d447.
3. Release the merged backend first and verify health/readiness and authenticated /admin/access/me. Release the matching Admin frontend with the existing BACKEND_API_URL, ADMIN_APP_ORIGIN and restricted browser Maps key configuration. The production backend remains https://infurnus-api-675633214574.asia-south2.run.app.
4. Existing Admins without recognized grants will lose administrative access. An authorized Super Admin must explicitly configure intended grants; never seed unrestricted grants or invent production account records.
5. Verify genuine authorized hosted photo upload/view, real fresh fleet data, session/permission revocation and approved business mutations. Roll back the coordinated frontend/backend release if compatibility fails.

Code merge is authorized separately. Production deployment, migrations, secret/configuration changes, account writes and fare activation have not been performed by this task.
