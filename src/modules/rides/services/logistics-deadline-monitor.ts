import type { Pool } from 'pg';
import type { NotificationService } from '../../notifications/services/notification.service.js';
import { env } from '../../../config/env.js';

export function logisticsDeadlineMonitor(
  pool: Pool,
  notifications?: Pick<NotificationService, 'send'>,
) {
  let running = false;
  let sender = notifications;
  return async () => {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query<{
        id: string;
        customerId: string;
        missed: boolean;
        reason: string;
      }>(
        `SELECT r.id, r.customer_id AS "customerId",
          r.created_at+INTERVAL '30 minutes'<=statement_timestamp() AS missed,
          CASE WHEN r.assigned_driver_id IS NULL THEN 'unassigned'
            WHEN f.pickup_eta_at>r.created_at+INTERVAL '30 minutes' THEN 'eta_exceeds_deadline'
            ELSE 'pickup_not_verified' END AS reason
         FROM rides r LEFT JOIN logistics_pickup_fulfillment f ON f.ride_id=r.id
         WHERE r.sector='logistics' AND r.status IN ('requested','searching','driver_assigned','driver_arriving','driver_arrived')
           AND f.pickup_arrived_at IS NULL
           AND CASE WHEN r.created_at+INTERVAL '30 minutes'<=statement_timestamp()
                    THEN f.delay_notified_at IS NULL
                    ELSE f.risk_notified_at IS NULL AND (
                      f.pickup_eta_at>r.created_at+INTERVAL '30 minutes'
                      OR (r.assigned_driver_id IS NULL AND r.created_at+INTERVAL '30 minutes'
                        <=statement_timestamp()+($1::int*INTERVAL '1 minute'))) END
         ORDER BY r.created_at LIMIT 20`,
        [env.LOGISTICS_URGENT_MINUTES],
      );
      if (!rows.length) return;
      const notifications = (sender ??= new (
        await import('../../notifications/services/notification.service.js')
      ).NotificationService());
      await Promise.allSettled(
        rows.map(async (ride) => {
          await notifications.send({
            userId: ride.customerId,
            type: 'logistics.delay',
            title: 'Logistics pickup update',
            body: ride.missed
              ? 'Your vehicle is taking longer than expected. Your booking is still active.'
              : 'Your vehicle may take longer than expected. Your booking is still active.',
            data: { rideId: ride.id, sector: 'logistics' },
            resourceId: ride.id,
            eventVersion: ride.missed ? 2 : 1,
          });
          const field = ride.missed ? 'delay_notified_at' : 'risk_notified_at';
          await pool.query(
            `INSERT INTO logistics_pickup_fulfillment (ride_id,${field},delay_reason)
           SELECT id,clock_timestamp(),$2 FROM rides WHERE id=$1
           ON CONFLICT (ride_id) DO UPDATE SET ${field}=COALESCE(logistics_pickup_fulfillment.${field},excluded.${field}),
             delay_reason=CASE WHEN $3 THEN excluded.delay_reason
               ELSE COALESCE(logistics_pickup_fulfillment.delay_reason,excluded.delay_reason) END`,
            [ride.id, ride.reason, ride.missed],
          );
        }),
      );
    } finally {
      running = false;
    }
  };
}
