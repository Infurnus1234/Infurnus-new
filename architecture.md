# INFURNUS Backend Architecture

**Document Status:** Architecture Baseline  
**Version:** 1.0  
**System:** INFURNUS Backend  
**Runtime:** Node.js + TypeScript  
**Framework:** Express  
**Primary Database:** PostgreSQL + PostGIS  
**Cache / Queue Infrastructure:** Redis + BullMQ

---

## 1. Purpose

This document defines the architectural baseline for the INFURNUS backend.

It establishes the system structure, module boundaries, technology choices, data ownership, request flow, security model, asynchronous processing, external integrations, and production-readiness principles.

The architecture is designed as a **modular monolith**: a single deployable backend application with strongly separated business modules and shared infrastructure.

The goal is to keep the system simple to develop and deploy while maintaining clear boundaries so individual modules can evolve independently.

---

## 2. Architecture Principles

The backend follows these principles:

1. **Modular monolith first**
   - One backend application.
   - Clear module boundaries.
   - No premature microservices.

2. **Separation of concerns**
   - Routes handle HTTP routing.
   - Controllers handle HTTP-level concerns.
   - Services contain business logic.
   - Repositories handle persistence.
   - Infrastructure adapters handle external systems.

3. **Business logic stays out of controllers**
   - Controllers should remain thin.
   - Complex decisions belong in services/domain logic.

4. **Database integrity is mandatory**
   - Application validation is not a replacement for database constraints.
   - Transactions are used where multiple writes must succeed or fail together.
   - Concurrency-sensitive operations must be protected at the database level.

5. **Least privilege**
   - Users and services receive only the permissions required for their operation.
   - Sensitive fields are never fetched unnecessarily.

6. **Security by default**
   - Authentication and authorization are enforced centrally.
   - Secrets are never committed to source control.
   - Sensitive operations receive additional authorization and auditing.

7. **Explicit external-provider boundaries**
   - External APIs are accessed through provider interfaces/adapters.
   - Business modules should not depend directly on provider-specific implementations.

8. **Observable production behavior**
   - Errors, important operations, queue failures, and external-provider failures must be observable.

9. **Idempotency for retryable operations**
   - Operations that may be retried must be designed to avoid duplicate side effects.

10. **Test critical business rules**
    - State transitions, authorization, payments, concurrency, and availability logic require dedicated tests.

---

## 3. High-Level System Architecture

```text
                         ┌──────────────────────┐
                         │   Client Applications │
                         │ Web / Mobile / Admin  │
                         └──────────┬───────────┘
                                    │
                              HTTPS / REST
                                    │
                         ┌──────────▼───────────┐
                         │     Express API      │
                         │   HTTP Entry Point   │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │       Common Infrastructure   │
                    │ Validation / Errors / Auth /  │
                    │ RBAC / Rate Limit / Logging   │
                    └───────────────┬────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
      ┌───────▼───────┐     ┌──────▼───────┐     ┌──────▼───────┐
      │ Business       │     │ Business     │     │ Business     │
      │ Modules       │     │ Modules      │     │ Modules      │
      │               │     │              │     │              │
      │ Users         │     │ Rides        │     │ Rentals      │
      │ Partners      │     │ Payments     │     │ Logistics    │
      │ Vehicles      │     │ Documents    │     │ Notifications│
      └───────┬───────┘     └──────┬───────┘     └──────┬───────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    │
                         ┌──────────▼───────────┐
                         │ Persistence / Data   │
                         │ Repository Layer     │
                         └───────┬───────┬──────┘
                                 │       │
                         ┌───────▼───┐ ┌─▼─────────┐
                         │PostgreSQL │ │   Redis   │
                         │ + PostGIS │ │ Cache/Jobs│
                         └───────────┘ └────┬──────┘
                                            │
                                     ┌──────▼──────┐
                                     │ BullMQ      │
                                     │ Workers     │
                                     └──────┬──────┘
                                            │
                         ┌──────────────────┼─────────────────┐
                         │                  │                 │
                    FCM / Push          SMS / Email      External APIs
```

---

## 4. Technology Stack

### Application

- Node.js
- TypeScript
- Express

### Database

- PostgreSQL
- PostGIS for geospatial operations

### Caching and Background Jobs

- Redis
- BullMQ

### Authentication and Security

- JWT access tokens
- Refresh-token rotation
- Refresh-token reuse detection
- Role-based access control
- Permission-based authorization where required
- HttpOnly cookies where applicable
- CSRF protection where applicable
- Helmet/security headers
- CORS allowlisting
- Rate limiting

### External Integrations

- Mappls
- Google Maps
- Razorpay
- FCM
- SMS provider
- Email provider
- Private object storage for documents

---

## 5. Repository Structure

```text
src/
├── config/
│   ├── env.ts
│   ├── database.ts
│   ├── redis.ts
│   └── logger.ts
│
├── common/
│   ├── errors/
│   ├── middleware/
│   ├── utils/
│   └── types/
│
├── modules/
│   ├── users/
│   ├── partners/
│   ├── vehicles/
│   ├── rides/
│   ├── rentals/
│   ├── logistics/
│   ├── payments/
│   ├── notifications/
│   └── documents/
│
├── app.ts
└── server.ts
```

### Module structure

Business modules should follow a consistent structure where appropriate:

```text
module/
├── routes/
├── controllers/
├── services/
├── repositories/
├── schemas/
├── types/
└── tests/
```

Not every module needs every directory. The structure should reflect actual complexity rather than create empty abstractions.

---

## 6. Request Processing Flow

A normal API request follows this general flow:

```text
HTTP Request
     │
     ▼
Express
     │
     ▼
Security / Request Middleware
     │
     ├── CORS
     ├── Security Headers
     ├── Rate Limiting
     ├── Request Context
     └── Authentication
     │
     ▼
Validation
     │
     ▼
Route
     │
     ▼
Controller
     │
     ▼
Service / Business Logic
     │
     ├──────────────► External Provider Adapter
     │
     ▼
Repository
     │
     ▼
PostgreSQL / PostGIS
     │
     ▼
Service
     │
     ▼
Controller
     │
     ▼
Standard Response
```

Controllers should not contain database queries or complex business rules.

---

## 7. Module Boundaries

### Users

Responsible for:

- User profiles
- Saved addresses
- Preferences
- User-facing account history
- User-related read operations

Authentication internals remain conceptually separate from user profile management.

### Partners

Responsible for:

- Partner profiles
- Partner onboarding data
- Availability state
- Partner/vehicle association
- Partner-related history and read operations
- Partner document metadata

Approval and authorization-sensitive operations must use centralized authorization rules.

### Vehicles

Responsible for:

- Vehicle records
- Vehicle types
- Vehicle-partner association
- Vehicle availability
- Vehicle status
- Vehicle search/query operations

### Rides

Responsible for:

- Ride requests
- Ride lifecycle
- Ride details
- Ride history
- Ride status history
- Ride cancellation
- Fare exposure/read APIs

Critical matching, transition, and concurrency rules must remain centralized rather than duplicated across endpoints.

### Rentals

Responsible for:

- Rental vehicle discovery
- Rental details
- Rental bookings
- Rental history
- Rental status
- Rental cancellation
- Rental duration/extension workflows

Availability must be protected against concurrent booking attempts.

### Logistics

Responsible for:

- Logistics orders
- Pickup/drop information
- Goods information
- Order status
- Delivery lifecycle
- Order history
- Cancellation

Assignment and concurrency-sensitive operations require transactional protection.

### Payments

Responsible for:

- Payment lifecycle
- Razorpay integration
- Order/payment verification
- Refunds
- Idempotency
- Payment state transitions
- Payment-related events

Webhook verification is treated as a security-critical boundary.

### Notifications

Responsible for:

- Notification records
- Notification templates
- Provider integrations
- Delivery status
- Asynchronous notification processing

Notification delivery should not unnecessarily block normal API requests.

### Documents

Responsible for:

- Document metadata
- Document status
- Document ownership
- Verification status
- Secure document access

Actual private file access should use short-lived signed URLs and appropriate authorization.

---

## 8. Authentication Architecture

Authentication uses:

```text
Short-lived Access Token
        +
Rotating Refresh Token
        +
Server-side Refresh Token Storage
```

### Access token

The access token is short-lived and used for authenticated API requests.

Recommended lifetime:

```text
15 minutes
```

The token should contain only the claims required for authorization and request context.

### Refresh tokens

Refresh tokens are:

- Long-lived relative to access tokens
- Stored securely
- Stored in hashed form server-side
- Rotated after successful use

The server must not store raw refresh tokens.

### Refresh-token rotation

General flow:

```text
Client
  │
  │ refresh token
  ▼
Validate token
  │
  ├── Invalid → reject
  │
  ├── Expired → reject
  │
  └── Valid
        │
        ▼
Revoke / consume current token
        │
        ▼
Issue new access token
        │
        ▼
Issue new refresh token
```

### Reuse detection

If a previously consumed refresh token is used again:

```text
Refresh token reuse detected
        ↓
Revoke token family / session chain
        ↓
Require fresh authentication
```

This protects against replay of stolen refresh tokens.

---

## 9. Authorization

Authorization is based on:

- Authentication state
- Role
- Permissions
- Resource ownership
- Operation sensitivity

Example roles:

```text
CUSTOMER
PARTNER
ADMIN
SUPER_ADMIN
```

Authorization must be enforced server-side.

A route must not assume that because a user is authenticated, they are allowed to access any resource.

Resource-level checks are required for operations such as:

```text
GET /rides/:id
GET /documents/:id
PATCH /users/:id
```

The system must verify that the authenticated principal has permission to access the requested resource.

---

## 10. Security Architecture

Security-sensitive behavior is centralized wherever practical.

### Required controls

- Helmet/security headers
- CORS allowlist
- Authentication middleware
- RBAC/permission middleware
- Rate limiting
- Strict validation
- CSRF protection where applicable
- Secure cookies where applicable
- Input/output handling
- Auditability for sensitive operations
- Secure secret management

### Secrets

Secrets must never be committed to Git.

Development may use a local `.env` file.

Production should use a dedicated secrets manager or cloud-native secret-management facility.

Only `.env.example` belongs in source control.

---

## 11. Validation

Zod is used for request validation.

Validation should cover:

- Body
- Query parameters
- Path parameters
- Relevant headers

Unknown or unexpected fields should be rejected where the endpoint contract requires strict input.

Validation errors should produce a consistent API error response.

---

## 12. Error Handling

The application uses centralized error handling.

Business/application errors should use structured error types rather than arbitrary strings.

Conceptually:

```text
Controller
   │
   ▼
Service
   │
   ├── expected application error
   │
   └── unexpected error
          │
          ▼
Central Error Middleware
          │
          ▼
Standard Error Response
```

Production responses must not expose:

- Stack traces
- Database internals
- Secrets
- Provider credentials
- Sensitive implementation details

Detailed errors should be available through server-side logging.

---

## 13. API Response Convention

The API should use a predictable response structure.

Success:

```json
{
  "success": true,
  "data": {},
  "message": "Operation successful"
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found"
  }
}
```

Exact response fields may evolve, but the contract should remain consistent across modules.

---

## 14. Database Architecture

PostgreSQL is the system of record.

PostGIS is used for geospatial operations.

Core data domains include:

```text
Users
Partners
Vehicles
Rides
Rentals
Logistics
Payments
Documents
Notifications
Authentication / Sessions
```

### Database principles

- Use migrations for schema changes.
- Use foreign keys where appropriate.
- Use unique constraints for uniqueness requirements.
- Use check constraints where valuable.
- Use indexes based on real query patterns.
- Use transactions for multi-step atomic operations.
- Avoid unnecessary database round trips.
- Fetch only required fields.
- Avoid selecting sensitive fields unless the operation requires them.

### Projection principle

Queries should explicitly consider the required projection/selected fields.

For example, a user profile read should not automatically retrieve:

```text
password hash
refresh token hashes
security metadata
unrelated internal fields
```

unless the specific operation requires them.

---

## 15. Transactions and Concurrency

Concurrency-sensitive business operations must not rely only on application-level checks.

Examples:

### Ride acceptance

```text
Driver A ─┐
          ├──► Database transaction ──► exactly one accepted
Driver B ─┘
```

The database must guarantee that two concurrent drivers cannot successfully accept the same ride.

### Rental booking

```text
Booking A ─┐
           ├──► Transaction / availability protection
Booking B ─┘
```

Only one booking may succeed when both requests target the same unavailable time window.

### Logistics assignment

Assignment operations must protect against multiple concurrent workers or requests assigning the same order incorrectly.

---

## 16. Rides State Machine

The primary ride lifecycle is:

```text
REQUESTED
    │
    ▼
ACCEPTED
    │
    ▼
IN_PROGRESS
    │
    ▼
COMPLETED
```

Cancellation may occur only from explicitly permitted states.

Invalid transitions must be rejected.

The transition rules should be centralized so that different endpoints cannot implement conflicting state logic.

---

## 17. Payments State Machine

The payment lifecycle is:

```text
INITIATED
    │
    ▼
AUTHORIZED
    │
    ▼
CAPTURED
    │
    ├──────────────► REFUNDED
    │
    └──────────────► FAILED
```

Payment state changes must be validated.

The system must be resilient to:

- Duplicate requests
- Webhook retries
- Provider delays
- Network failures
- Partial failures

---

## 18. Payment Webhook Security

Webhook endpoints are security-critical.

A webhook must not be trusted merely because it reaches the public endpoint.

The system must:

1. Receive the raw webhook payload as required by the provider.
2. Verify the provider signature using the configured secret.
3. Reject invalid/tampered payloads.
4. Validate the event structure.
5. Apply idempotent state changes.
6. Record appropriate processing information.
7. Return the appropriate provider response.

Signature verification must occur before trusting webhook data.

Secrets used for webhook verification must never be committed to source control.

---

## 19. Idempotency

Idempotency is required for operations where retries can cause harmful duplicate side effects.

Important examples:

- Payment creation
- Payment confirmation
- Refund operations
- Rental booking
- Other financially or inventory-sensitive operations

Conceptually:

```text
Request + Idempotency Key
          │
          ▼
Check previous operation
     │           │
     │ exists    │ doesn't exist
     ▼           ▼
Return result   Execute operation
                    │
                    ▼
               Persist result
```

A retry should not create a second charge or second booking.

---

## 20. Maps Architecture

Map functionality is accessed through a provider abstraction.

Conceptual interface:

```text
MapProvider
├── geocode()
├── route()
├── eta()
└── distanceMatrix()
```

Providers:

```text
MapProvider
   ├── MapplsProvider
   └── GoogleMapsProvider
```

Mappls is the primary provider.

Google Maps is the fallback provider.

Business logic should depend on the `MapProvider` abstraction rather than directly depending on a provider SDK.

For MVP failover:

```text
Mappls request
      │
      ├── success ──► return result
      │
      └── failure
             │
             ▼
       Google fallback
```

---

## 21. Geospatial Architecture

PostGIS handles geospatial operations such as:

- Nearby-driver search
- Distance calculations
- Location filtering
- Spatial indexing

Location-heavy queries should use appropriate PostGIS indexes and query plans.

The system should avoid loading large sets of locations into application memory when the database can perform the spatial filtering efficiently.

---

## 22. Real-Time Architecture

Socket.IO is used for real-time communication.

Connection flow:

```text
Client
  │
  ▼
Socket.IO handshake
  │
  ▼
JWT authentication
  │
  ▼
Authorized connection
```

Ride-specific rooms use:

```text
ride:{rideId}
```

A user may join a ride room only if they are authorized to access that ride.

Real-time events should be scoped to the relevant room.

Important behaviors include:

- Connection authentication
- Room authorization
- Reconnection handling
- Disconnect cleanup
- Active ride location updates

---

## 23. Redis Architecture

Redis is used for infrastructure workloads such as:

- BullMQ queues
- Queue state
- Short-lived caching where appropriate
- Rate-limit support where appropriate
- Other ephemeral coordination data where justified

Redis must not silently become the source of truth for persistent business data that belongs in PostgreSQL.

---

## 24. Background Jobs

BullMQ provides asynchronous job processing.

General architecture:

```text
Business Event
      │
      ▼
BullMQ Queue
      │
      ▼
Worker
      │
      ▼
Provider / Side Effect
```

Examples:

```text
Ride Accepted
      ↓
Notification Job
      ↓
Worker
      ↓
FCM / SMS / Email
```

Workers should support:

- Retry
- Exponential/backoff strategy where appropriate
- Failure handling
- Dead-letter handling
- Idempotent processing
- Structured logging

---

## 25. Notification Architecture

Notifications follow a business-event-driven architecture:

```text
Business Event
      │
      ▼
Queue
      │
      ▼
Notification Worker
      │
      ├── FCM
      ├── SMS
      └── Email
```

API requests should not be unnecessarily blocked while waiting for external notification providers.

Notification records should capture relevant delivery information such as:

- Recipient
- Notification type
- Created time
- Processing status
- Delivery status
- Failure information where appropriate

---

## 26. Documents Architecture

Documents may contain sensitive personal/KYC information.

The architecture uses:

```text
Private Object Storage
        │
        ▼
Signed URL
        │
        ▼
Short-lived authorized access
```

Documents should not be publicly accessible.

The backend must verify authorization before issuing access to a document.

Document metadata and file access are separate concerns.

---

## 27. Admin Architecture

Administrative APIs require elevated authorization.

Admin operations are divided conceptually into:

```text
ADMIN
   │
   └── routine administrative operations

SUPER_ADMIN
   │
   └── highly sensitive operations
```

Examples of sensitive operations include:

- Final approval actions
- Refund issuance triggers
- Security-sensitive configuration
- Other privileged state changes

Admin read APIs should support appropriate:

- Filtering
- Pagination
- Sorting
- Date ranges
- Status filters

Sensitive operations should be auditable.

---

## 28. Logging and Observability

The backend should provide structured server-side logging.

Important events include:

- Application startup/shutdown
- Authentication failures
- Authorization failures
- Important state transitions
- Payment events
- Webhook processing
- Queue failures
- External-provider failures
- Database errors
- Unexpected application errors

Logs must not contain:

- Passwords
- Raw refresh tokens
- Secrets
- Payment secrets
- Private document contents
- Unnecessary sensitive personal information

---

## 29. Configuration Management

Application configuration is environment-driven.

Typical configuration categories:

```text
Application
Database
Redis
Authentication
Payments
Maps
Notifications
Object Storage
CORS
Rate Limiting
Logging
```

Configuration should be validated at application startup.

Invalid required configuration should fail fast rather than allow the application to start in a broken state.

---

## 30. Testing Strategy

Testing should exist at multiple levels.

### Unit tests

Used for:

- Business rules
- State transitions
- Validation behavior
- Fare calculations
- Authorization logic
- Utility functions

### Integration tests

Used for:

- API + database behavior
- Authentication flows
- Repository behavior
- Transactions
- Module interactions

### Concurrency tests

Required for:

- Ride acceptance
- Rental booking
- Logistics assignment
- Other race-sensitive operations

### End-to-end testing

Important cross-module flows include:

```text
Ride creation
    ↓
Matching
    ↓
Acceptance
    ↓
Location tracking
    ↓
Completion
    ↓
Payment
    ↓
Notification
```

---

## 31. API Documentation

Each module should document:

- Endpoints
- HTTP methods
- Authentication requirements
- Authorization requirements
- Request schema
- Response schema
- Error codes
- Pagination behavior
- Important business rules

Documentation should remain synchronized with implementation.

---

## 32. Database Migration Strategy

All schema changes must be represented through version-controlled migrations.

Rules:

1. Never manually modify production schema without a migration.
2. Migrations must be deterministic.
3. Migration order must be preserved.
4. Destructive migrations require careful review.
5. Database changes should be backward-compatible where rolling deployment requires it.

---

## 33. Deployment Architecture

The backend is containerized.

Conceptually:

```text
                    ┌─────────────────┐
                    │ Client          │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Load Balancer / │
                    │ Reverse Proxy   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Backend API     │
                    │ Container(s)    │
                    └───────┬─────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
        PostgreSQL        Redis        External APIs
        + PostGIS                       Maps/Payment/etc.
```

Background workers may run as separate processes/containers while sharing the same application codebase.

---

## 34. CI/CD Principles

Pull requests should automatically run:

```text
Install dependencies
        ↓
TypeScript check
        ↓
Lint
        ↓
Tests
        ↓
Build
```

Main branch should remain in a deployable state.

Production deployment should require successful CI.

---

## 35. Git and Code Quality

The repository should use:

- Protected main branch
- Pull requests
- Required CI checks
- Code review
- Consistent commit messages
- Consistent formatting
- Automated linting
- Automated tests

Direct pushes to protected production branches should be avoided.

---

## 36. Performance Principles

Performance decisions should prioritize:

1. Correctness
2. Database efficiency
3. Appropriate indexes
4. Minimal data retrieval
5. Avoiding unnecessary round trips
6. Appropriate caching
7. Async processing for non-critical side effects
8. Efficient geospatial queries
9. Connection pooling
10. Measured optimization rather than premature optimization

Every database query should consider:

- Filter
- Projection
- Index usage
- Sort
- Pagination
- Transaction requirements
- Concurrency
- Data sensitivity

---

## 37. Data Security

Sensitive information must be handled carefully.

Examples include:

- Password hashes
- Refresh-token hashes
- KYC/document metadata
- Payment information
- Authentication/session information
- Personal information

Principles:

- Store only what is required.
- Fetch only what is required.
- Do not expose internal fields through API responses.
- Restrict access based on authorization.
- Avoid sensitive data in logs.
- Protect data in transit and at rest through the appropriate infrastructure controls.

---

## 38. Failure Handling

External systems are inherently unreliable.

The backend should expect:

- Network timeouts
- Provider errors
- Duplicate callbacks
- Temporary database failures
- Redis failures
- Queue failures
- Partial operations

Critical operations must define what happens when a dependency fails.

For retryable operations:

```text
Attempt
  ↓
Failure
  ↓
Retry when safe
  ↓
Final failure
  ↓
Record / alert / compensate
```

Retries must not create duplicate business side effects.

---

## 39. Health and Readiness

The application should expose health information suitable for deployment infrastructure.

At minimum, distinguish between:

```text
Liveness
    "Is the process running?"

Readiness
    "Can the application serve traffic?"
```

Readiness may depend on required infrastructure such as the database and Redis where appropriate.

Health endpoints should not expose secrets or sensitive internal information.

---

## 40. Architecture Decision Rules

When introducing a new dependency or architectural pattern, evaluate:

- Is it required?
- Does it solve a real problem?
- Does it increase operational complexity?
- Can the existing architecture handle the requirement?
- Does it preserve module boundaries?
- Does it introduce security risks?
- Does it affect database integrity?
- Does it complicate testing?
- Does it create vendor lock-in?

Prefer the simplest design that satisfies the production requirement.

---

## 41. Non-Goals

The initial architecture does not require:

- Microservices
- Event sourcing
- CQRS everywhere
- Distributed transactions across services
- Complex service meshes
- Full circuit-breaker infrastructure for every provider
- Premature horizontal scaling
- Multiple databases without a demonstrated need

These can be introduced later if actual scale or operational requirements justify them.

---

## 42. Summary

INFURNUS uses a **production-oriented modular monolith** built around:

```text
Node.js
   +
TypeScript
   +
Express
   +
PostgreSQL/PostGIS
   +
Redis/BullMQ
```

The architecture emphasizes:

- Clear module boundaries
- Centralized security
- Strong database integrity
- Transactional concurrency control
- Provider abstractions
- Idempotent financial/inventory operations
- Asynchronous notifications
- Secure document access
- Structured errors and logging
- Automated testing and CI
- Environment-based configuration
- Production observability

The architecture should evolve through explicit, documented decisions while preserving these core principles.
