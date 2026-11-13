import type { Pool, PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
import { rideEvents } from '../events/ride.events.js';
import { driverEligibilitySql } from '../repositories/driver-eligibility.js';
import type { MapProvider } from '../providers/map.provider.js';

const candidates = `
  SELECT dp.id AS "driverId", u.id AS "userId", u.role,
         concat_ws(' ', u.first_name, u.last_name) AS name, v.id AS "vehicleId",
         v.category, v.owner_id AS "vehicleOwnerId",
         fleet.id AS "fleetOwnerId", concat_ws(' ', fleet.first_name, fleet.last_name) AS "fleetOwnerName",
         ST_Distance(dp.last_location,r.pickup_location) AS "distanceMeters",
         ST_Y(dp.last_location::geometry) AS latitude,
         ST_X(dp.last_location::geometry) AS longitude,
         ST_Y(r.pickup_location::geometry) AS "pickupLatitude",
         ST_X(r.pickup_location::geometry) AS "pickupLongitude"
  FROM rides r
  JOIN vehicles v ON v.sector='logistics' AND v.category=r.vehicle_category
  JOIN driver_profiles dp ON dp.id=v.driver_profile_id
  JOIN users u ON u.id=dp.user_id
  LEFT JOIN partners partner ON partner.user_id=v.owner_id AND partner.approval_status='approved'
  LEFT JOIN users fleet ON fleet.id=partner.user_id AND fleet.role IN ('fleet_owner','driver_fleet_owner')
    AND fleet.status='active' AND fleet.deleted_at IS NULL
  WHERE r.id=$1 AND r.sector='logistics' AND r.status='searching'
    AND ${driverEligibilitySql("clock_timestamp()-($2::int * INTERVAL '1 second')", 'r.id', 'r.customer_id')}
    AND ST_DWithin(dp.last_location,r.pickup_location,20000.000001)
`;

export class LogisticsTargetedDispatch {
  constructor(
    private readonly pool: Pool,
    private readonly maps?: MapProvider,
  ) {}

  async listCandidates(rideId: string) {
    const { rows } = await this.pool.query(
      candidates + ' ORDER BY "distanceMeters", "driverId" LIMIT 50',
      [rideId, env.DRIVER_LOCATION_STALE_SECONDS],
    );
    if (!rows.length || !this.maps) return rows;
    const nearest = rows.slice(0, 12);
    try {
      const results = await this.maps.calculateMatrix(
        nearest.map(({ latitude, longitude }) => ({ latitude, longitude })),
        { latitude: nearest[0]!.pickupLatitude, longitude: nearest[0]!.pickupLongitude },
        { source: 'ADMIN' },
      );
      return rows
        .map((row) => ({
          ...row,
          etaSeconds:
            results.find(
              ({ origin }) =>
                origin.latitude === row.latitude && origin.longitude === row.longitude,
            )?.route?.durationSeconds ?? null,
        }))
        .sort(
          (first, second) =>
            (first.etaSeconds ?? Infinity) - (second.etaSeconds ?? Infinity) ||
            first.distanceMeters - second.distanceMeters,
        );
    } catch {
      return rows;
    }
  }

  async history(rideId: string) {
    const { rows } = await this.pool.query(
      `SELECT o.id, o.kind, o.parent_offer_id AS "parentOfferId", o.admin_id AS "adminId", o.recipient_id AS "recipientId",
        o.driver_profile_id AS "driverId", o.vehicle_id AS "vehicleId",
        o.created_at AS "createdAt", o.expires_at AS "expiresAt",
        COALESCE(o.responded_at, CASE WHEN o.status='pending' AND o.expires_at<=clock_timestamp()
          THEN o.expires_at END) AS "respondedAt",
        o.notification_id AS "notificationId",
        notification.delivery_status AS "notificationStatus",
        CASE WHEN o.status IN ('pending','coordinating','forwarded') AND o.expires_at<=clock_timestamp()
          THEN 'expired' ELSE o.status END AS status,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('adminId', ring.admin_id, 'createdAt', ring.created_at,
          'notificationId', ring.notification_id, 'notificationStatus', ring_push.delivery_status)
          ORDER BY ring.created_at DESC) FROM logistics_dispatch_rings ring
          LEFT JOIN notifications ring_push ON ring_push.id=ring.notification_id
          WHERE ring.offer_id=o.id), '[]') AS rings
       FROM logistics_dispatch_offers o JOIN rides r ON r.id=o.ride_id
       LEFT JOIN notifications notification ON notification.id=o.notification_id
       WHERE r.id=$1 AND r.sector='logistics'
       ORDER BY o.created_at DESC LIMIT 100`,
      [rideId],
    );
    return rows;
  }

  async ring(rideId: string, adminId: string, offerId: string) {
    const result = await this.pool.query<{
      id: string;
      recipientId: string;
      expiresAt: Date;
      notificationId: string;
    }>(
      `WITH booking AS MATERIALIZED (
         SELECT id FROM rides WHERE id=$1 AND status='searching' AND sector='logistics' FOR UPDATE
       ), claimed AS (
         UPDATE logistics_dispatch_offers o SET last_ring_at=clock_timestamp()
         FROM booking WHERE booking.id=o.ride_id
           AND o.id=$2 AND o.status='pending' AND o.expires_at>clock_timestamp()
           AND o.created_at<=clock_timestamp()-INTERVAL '30 seconds'
           AND (o.last_ring_at IS NULL OR o.last_ring_at<=clock_timestamp()-INTERVAL '30 seconds')
         RETURNING o.id
       ), ringing AS (
         INSERT INTO logistics_dispatch_rings (offer_id, admin_id)
         SELECT id,$3 FROM claimed
         RETURNING id, offer_id
       )
       SELECT o.id, o.kind, o.recipient_id AS "recipientId", o.expires_at AS "expiresAt",
         ringing.id AS "notificationId"
       FROM ringing JOIN logistics_dispatch_offers o ON o.id=ringing.offer_id`,
      [rideId, offerId, adminId],
    );
    const ring = result.rows[0];
    if (!ring)
      throw new AppError(
        'LOGISTICS_RING_CONFLICT',
        'Offer is unavailable or was alerted recently',
        409,
      );
    rideEvents.emit('logistics:offer_created', { ...ring, rideId });
    return ring;
  }

  async offer(
    rideId: string,
    adminId: string,
    driverId: string,
    vehicleId: string,
    kind: 'driver' | 'fleet' = 'driver',
  ) {
    const client = await this.pool.connect();
    let offer: { id: string; recipientId: string; expiresAt: Date };
    try {
      await client.query('BEGIN');
      await this.lockSearchingBooking(client, rideId);
      await client.query(
        `UPDATE logistics_dispatch_offers SET status='expired', responded_at=expires_at
         WHERE ride_id=$1 AND status IN ('pending','coordinating','forwarded') AND expires_at<=clock_timestamp()`,
        [rideId],
      );
      const result = await client.query<typeof offer>(
        `INSERT INTO logistics_dispatch_offers (ride_id, admin_id, recipient_id, driver_profile_id, vehicle_id, expires_at, kind)
         SELECT $1,$5,recipient.id,"driverId","vehicleId",clock_timestamp()+($6::int * INTERVAL '1 second'),$7
         FROM (${candidates} AND dp.id=$3 AND v.id=$4) candidate
         CROSS JOIN LATERAL (SELECT CASE WHEN $7='fleet' THEN candidate."fleetOwnerId" ELSE candidate."userId" END AS id) recipient
         WHERE recipient.id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM logistics_dispatch_offers previous
           WHERE previous.ride_id=$1 AND previous.recipient_id=recipient.id AND previous.kind=$7
             AND (previous.status IN ('pending','coordinating','forwarded') OR previous.created_at>clock_timestamp()-INTERVAL '30 seconds')
         )
         RETURNING id, recipient_id AS "recipientId", expires_at AS "expiresAt"`,
        [
          rideId,
          env.DRIVER_LOCATION_STALE_SECONDS,
          driverId,
          vehicleId,
          adminId,
          env.LOGISTICS_DIRECT_OFFER_SECONDS,
          kind,
        ],
      );
      const created = result.rows[0];
      if (!created)
        throw new AppError(
          'LOGISTICS_OFFER_CONFLICT',
          'Recipient is unavailable or has a recent offer',
          409,
        );
      offer = created;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    rideEvents.emit('logistics:offer_created', { ...offer, rideId, kind });
    return offer;
  }

  async fleetOffers(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT o.id, o.ride_id AS "rideId", o.expires_at AS "expiresAt",
         CASE WHEN o.status IN ('pending','coordinating','forwarded') AND o.expires_at<=clock_timestamp()
           THEN 'expired' ELSE o.status END AS status,
         r.booking_id AS "bookingId", r.vehicle_category AS category,
         r.pickup_address AS pickup, r.created_at+INTERVAL '30 minutes' AS deadline,
         statement_timestamp() AS "serverTime",
         (SELECT CASE WHEN child.status='pending' AND child.expires_at<=clock_timestamp()
           THEN 'expired' ELSE child.status END
          FROM logistics_dispatch_offers child WHERE child.parent_offer_id=o.id
          ORDER BY child.created_at DESC LIMIT 1) AS "driverResponse"
       FROM logistics_dispatch_offers o JOIN rides r ON r.id=o.ride_id
       WHERE o.recipient_id=$1 AND o.kind='fleet' AND o.created_at>NOW()-INTERVAL '24 hours'
       ORDER BY o.created_at DESC LIMIT 25`,
      [userId],
    );
    return rows;
  }

  async fleetRespond(userId: string, offerId: string, accept: boolean) {
    const result = await this.pool.query(
      `WITH locked AS MATERIALIZED (
         SELECT r.id FROM logistics_dispatch_offers o JOIN rides r ON r.id=o.ride_id
         WHERE o.id=$1 AND o.recipient_id=$2 AND o.kind='fleet' AND r.status='searching' FOR UPDATE OF r
       )
       UPDATE logistics_dispatch_offers o SET status=$3, responded_at=clock_timestamp()
       FROM locked WHERE o.ride_id=locked.id AND o.id=$1 AND o.status='pending'
         AND o.expires_at>clock_timestamp()`,
      [offerId, userId, accept ? 'coordinating' : 'rejected'],
    );
    if (!result.rowCount)
      throw new AppError('LOGISTICS_OFFER_CONFLICT', 'Offer is no longer available', 409);
  }

  async fleetCandidates(userId: string, offerId: string) {
    const { rows } = await this.pool.query(
      candidates.replace(
        'r.id=$1',
        `r.id=(SELECT o.ride_id FROM logistics_dispatch_offers o
        WHERE o.id=$1 AND o.recipient_id=$3 AND o.kind='fleet' AND o.status='coordinating'
          AND o.expires_at>clock_timestamp())`,
      ) + ' AND v.owner_id=$3 ORDER BY "distanceMeters" LIMIT 50',
      [offerId, env.DRIVER_LOCATION_STALE_SECONDS, userId],
    );
    return rows;
  }

  async fleetForward(userId: string, offerId: string, driverId: string, vehicleId: string) {
    const client = await this.pool.connect();
    let offer: { id: string; rideId: string; recipientId: string; expiresAt: Date };
    try {
      await client.query('BEGIN');
      const parent = await client.query<{ ride_id: string }>(
        `SELECT o.ride_id FROM logistics_dispatch_offers o JOIN rides r ON r.id=o.ride_id
         WHERE o.id=$1 AND o.recipient_id=$2 AND o.kind='fleet' AND r.status='searching' FOR UPDATE OF r`,
        [offerId, userId],
      );
      const rideId = parent.rows[0]?.ride_id;
      if (!rideId)
        throw new AppError('LOGISTICS_OFFER_CONFLICT', 'Coordination offer unavailable', 409);
      const forwarded = await client.query(
        `UPDATE logistics_dispatch_offers SET status='forwarded' WHERE id=$1 AND status='coordinating'
           AND expires_at>clock_timestamp() RETURNING id`,
        [offerId],
      );
      if (!forwarded.rowCount)
        throw new AppError('LOGISTICS_OFFER_CONFLICT', 'Coordination offer unavailable', 409);
      await client.query(
        `UPDATE logistics_dispatch_offers SET status='expired', responded_at=expires_at
         WHERE ride_id=$1 AND kind='driver' AND status='pending' AND expires_at<=clock_timestamp()`,
        [rideId],
      );
      const { rows } = await client.query<typeof offer>(
        `INSERT INTO logistics_dispatch_offers (ride_id, admin_id, recipient_id, driver_profile_id, vehicle_id, expires_at, parent_offer_id)
         SELECT $1,parent.admin_id,candidate."userId",candidate."driverId",candidate."vehicleId",
           clock_timestamp()+($7::int * INTERVAL '1 second'),parent.id
         FROM (${candidates} AND dp.id=$3 AND v.id=$4 AND v.owner_id=$5 AND fleet.id=$5) candidate
         JOIN logistics_dispatch_offers parent ON parent.id=$6
         ON CONFLICT (ride_id,recipient_id,kind) WHERE status IN ('pending','coordinating','forwarded')
           DO NOTHING
         RETURNING id, ride_id AS "rideId", recipient_id AS "recipientId", expires_at AS "expiresAt"`,
        [
          rideId,
          env.DRIVER_LOCATION_STALE_SECONDS,
          driverId,
          vehicleId,
          userId,
          offerId,
          env.LOGISTICS_DIRECT_OFFER_SECONDS,
        ],
      );
      if (!rows[0])
        throw new AppError(
          'LOGISTICS_OFFER_CONFLICT',
          'Driver or vehicle is no longer available',
          409,
        );
      offer = rows[0];
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    rideEvents.emit('logistics:offer_created', { ...offer, kind: 'driver' });
    return offer;
  }

  private async lockSearchingBooking(client: PoolClient, rideId: string) {
    const { rowCount } = await client.query(
      "SELECT id FROM rides WHERE id=$1 AND sector='logistics' AND status='searching' FOR UPDATE",
      [rideId],
    );
    if (!rowCount)
      throw new AppError(
        'LOGISTICS_BOOKING_UNAVAILABLE',
        'Booking is no longer available for dispatch',
        409,
      );
  }
}
