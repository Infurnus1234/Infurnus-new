import type { Pool } from 'pg';
import { NotificationService } from '../../notifications/services/notification.service.js';

export function logisticsOfferNotifications(pool: Pool) {
  const service = new NotificationService();
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query<{
        eventId: string;
        offerId: string;
        rideId: string;
        userId: string;
        expiresAt: Date;
        kind: 'driver' | 'fleet';
        ring: boolean;
      }>(
        `SELECT coalesce(ring.id,o.id) AS "eventId", o.id AS "offerId", o.ride_id AS "rideId",
           o.recipient_id AS "userId", o.expires_at AS "expiresAt", o.kind, ring.id IS NOT NULL AS ring
         FROM logistics_dispatch_offers o
         JOIN rides r ON r.id=o.ride_id AND r.sector='logistics' AND r.status='searching'
         LEFT JOIN logistics_dispatch_rings ring ON ring.offer_id=o.id AND ring.notification_id IS NULL
         WHERE o.status='pending' AND o.expires_at>clock_timestamp()
           AND (o.notification_id IS NULL OR ring.id IS NOT NULL)
         ORDER BY o.expires_at LIMIT 50`,
      );
      const results = await Promise.allSettled(
        rows.map(async (offer) => {
          const notificationId = await service.send({
            userId: offer.userId,
            type: offer.kind === 'fleet' ? 'logistics.fleet_offer' : 'ride.created',
            title: offer.kind === 'fleet' ? 'Logistics fleet request' : 'Logistics booking request',
            body: 'Open INFURNUS to review the current offer.',
            data: {
              rideId: offer.rideId,
              sector: 'logistics',
              expiresAt: offer.expiresAt.toISOString(),
              channelId: 'infurnus_logistics_offers',
              logisticsTargeted: 'true',
              dispatchOfferId: offer.offerId,
              ...(offer.ring ? { dispatchRing: 'true' } : {}),
            },
            resourceId: offer.eventId,
            eventVersion: 1,
          });
          const table = offer.ring ? 'logistics_dispatch_rings' : 'logistics_dispatch_offers';
          await pool.query(
            `UPDATE ${table} SET notification_id=$2 WHERE id=$1 AND notification_id IS NULL`,
            [offer.eventId, notificationId],
          );
        }),
      );
      if (results.some((result) => result.status === 'rejected'))
        console.warn('Some Logistics offer notifications could not be queued');
    } finally {
      running = false;
    }
  };
}
