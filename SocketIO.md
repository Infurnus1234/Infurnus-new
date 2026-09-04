# INFURNUS — Socket.IO Architecture

## 1. Overview

INFURNUS uses Socket.IO for realtime communication between the Customer/Driver applications and the backend.

Socket.IO will be used for:

- Realtime ride events
- Driver live location updates
- Ride-specific realtime communication
- Connection/disconnection handling
- Reconnection
- Realtime ride status synchronization

Socket.IO is a realtime transport layer. Ride state and business logic remain in the backend services/database.

---

## 2. Architecture

```text
Customer App
     │
     │ Socket.IO
     ▼
┌─────────────────────┐
│   Socket.IO Server  │
├─────────────────────┤
│ Authentication       │
│ Connection Handling  │
│ Event Handling       │
│ Room Management      │
│ Payload Validation   │
└──────────┬──────────┘
           │
           ▼
    Rides / Location
       Services
           │
     ┌─────┴─────┐
     ▼           ▼
PostgreSQL     PostGIS
````

Driver App follows the same architecture.

```text
Driver App
    │
    │ Socket.IO
    ▼
Socket.IO Server
    │
    ▼
Rides / Location Services
    │
    ├── PostgreSQL
    └── PostGIS
```

---

## 3. Socket Connection

A client establishes a Socket.IO connection with the backend.

```text
Client
  │
  ▼
Socket Connection
  │
  ▼
Authentication
  │
  ▼
Authenticated Socket
  │
  ▼
Realtime Events
```

Each socket connection represents one authenticated client session.

The server maintains the authenticated user identity in the socket context.

---

## 4. Authentication

Socket.IO connections use the existing INFURNUS authentication system.

```text
Client
  │
  │ Access Token
  ▼
Socket.IO Authentication
  │
  ├── Valid → Connection accepted
  │
  └── Invalid/Expired → Connection rejected
```

The client identity is derived from the authenticated token.

Client-provided `userId`, `driverId`, or `customerId` must not be used as the source of identity.

---

## 5. Token Expiration

If the access token expires while a socket is connected:

```text
Socket Connected
      │
      ▼
Access Token Expires
      │
      ▼
Socket Disconnected
      │
      ▼
HTTP Auth Refresh
      │
      ▼
New Access Token
      │
      ▼
Socket Reconnect
      │
      ▼
Authentication Again
```

Socket.IO does not implement a separate refresh-token mechanism.

---

## 6. Ride Rooms

Each active ride has a dedicated Socket.IO room:

```text
ride:{rideId}
```

Example:

```text
ride:8f4c2...
```

The room contains only the authorized participants of that ride.

```text
Customer
    │
    ├──────────────┐
    │              │
    ▼              ▼
 ride:123       Driver
    │
    └── Realtime Ride Events
```

Room access must be authorized against the ride before joining.

---

## 7. Ride Realtime Flow

```text
Ride Service
     │
     │ Ride State Change
     ▼
Socket.IO Server
     │
     ▼
ride:{rideId}
     │
     ├──────────────► Customer
     │
     └──────────────► Driver
```

Examples of realtime ride events:

```text
ride:requested
ride:assigned
ride:accepted
ride:driver_arrived
ride:started
ride:status_changed
ride:cancelled
ride:completed
```

Socket.IO broadcasts events after the corresponding backend operation/state change.

---

## 8. Driver Live Location

Driver GPS location is sent through Socket.IO.

```text
Driver Mobile App
       │
       │ GPS Location
       ▼
Socket.IO
       │
       ▼
Location Service
       │
       ├──────────► PostGIS
       │
       └──────────► Ride Room
                         │
                         ▼
                     Customer
```

Location payload:

```json
{
  "latitude": 28.6139,
  "longitude": 77.2090,
  "timestamp": "2026-09-05T12:00:00.000Z"
}
```

The server derives the driver identity from the authenticated socket.

---

## 9. Location Update Flow

```text
Driver GPS
    │
    ▼
driver:location:update
    │
    ▼
Authentication
    │
    ▼
Payload Validation
    │
    ▼
Authorization
    │
    ▼
Rate Limiting
    │
    ▼
Location Service
    │
    ├── Store/update location
    │
    └── Broadcast location
              │
              ▼
         ride:{rideId}
              │
              ▼
           Customer
```

Socket.IO transports the realtime location.

PostGIS stores and queries geographic data.

Google Maps handles routing/ETA separately.

---

## 10. Event Structure

Client → Server:

```text
ride:request
ride:accept
ride:cancel
driver:location:update
```

Server → Client:

```text
ride:requested
ride:assigned
ride:accepted
ride:driver_arrived
ride:started
ride:location:updated
ride:status_changed
ride:cancelled
ride:completed
```

Every event payload is validated using Zod before processing.

---

## 11. Connection and Reconnection

```text
Connected
   │
   ▼
Realtime Communication
   │
   ▼
Disconnected
   │
   ▼
Reconnect
   │
   ▼
Authenticate Again
   │
   ▼
Authorize Again
   │
   ▼
Restore Active Ride Context
```

After reconnection, the current ride state is synchronized from the backend rather than relying only on missed Socket.IO events.

---

## 12. Redis Adapter

For multiple backend instances:

```text
                Load Balancer
                /     |     \
               ▼      ▼      ▼
           Server A Server B Server C
               \      |      /
                \     |     /
                   Redis
                     │
              Socket.IO Adapter
```

Redis is used for Socket.IO instance-to-instance event synchronization.

PostgreSQL remains the source of truth for ride/business state.

---

## 13. Realtime Data Flow

### Customer

```text
Customer App
     │
     ▼
Socket.IO
     │
     ▼
Ride Room
     │
     ├── Ride Status
     ├── Driver Location
     ├── Driver Arrival
     └── Trip Status
```

### Driver

```text
Driver App
     │
     ▼
Socket.IO
     │
     ▼
Ride Room
     │
     ├── Ride Request
     ├── Customer/Pickup Updates
     ├── Ride Status
     └── Trip Status
```

---

## 14. Socket.IO Boundary

```text
┌─────────────────────────────────────┐
│             Socket.IO               │
│                                     │
│ Connection                          │
│ Authentication                      │
│ Rooms                               │
│ Realtime Events                     │
│ Live Location Transport             │
│ Reconnection                        │
│ Event Validation                    │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│          Backend Services            │
│                                     │
│ Rides                               │
│ Location                            │
│ Business Rules                      │
└──────────────────┬──────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
     PostgreSQL           PostGIS
```

Socket.IO does not directly implement ride business rules or database business logic.

---

## 15. Authentication Ownership

Authentication used by Socket.IO will be the existing INFURNUS Auth system.

*Authentication is currently being implemented by Niranjan.*

Socket.IO will integrate with that authentication implementation.

```
```
