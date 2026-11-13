import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
import { LogisticsTargetedDispatch } from '../../rides/services/logistics-targeted-dispatch.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import { env } from '../../../config/env.js';
import { logisticsDispatchStream } from '../services/logistics-dispatch-stream.js';
export function createLogisticsAdminRouter(pool: Pool, maps?: MapProvider) {
  const router = Router();
  router.use(requireAuth, requireRoles('admin', 'super_admin'));
  const dispatch = new LogisticsTargetedDispatch(pool, maps);
  const subscribeDispatch = logisticsDispatchStream(pool);
  router.use('/dispatch/:rideId', async (req, res, next) => {
    try {
      await new PostgresProviderOperationsRepository(pool).authorize(
        req.auth!.userId,
        req.auth!.role,
      );
      if (
        req.auth!.role !== 'super_admin' &&
        !['logistics.read', 'rides.read', 'logistics.dispatch'].every((key) =>
          res.locals.adminPermissions?.includes(key),
        )
      )
        throw new AppError('FORBIDDEN', 'Logistics dispatch permission required', 403);
      res.set('Cache-Control', 'no-store');
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get('/dispatch/:rideId/candidates', async (req, res) => {
    res.json({
      success: true,
      data: await dispatch.listCandidates(z.string().uuid().parse(req.params.rideId)),
    });
  });
  router.get('/dispatch/:rideId/offers', async (req, res) => {
    res.json({
      success: true,
      data: await dispatch.history(z.string().uuid().parse(req.params.rideId)),
    });
  });
  router.get('/dispatch/:rideId/history', async (req, res) => {
    const id = z.string().uuid().parse(req.params.rideId);
    const { rows } = await pool.query(
      `WITH booking AS (SELECT * FROM rides WHERE id=$1 AND sector='logistics'),
       activity AS (
         SELECT 'Booking created' AS event, created_at AS at, NULL::uuid AS actor, NULL::text AS detail FROM booking
         UNION ALL SELECT 'Escalated', logistics_escalated_at, NULL, logistics_escalation_reason
           FROM booking WHERE logistics_escalated_at IS NOT NULL
         UNION ALL SELECT 'Urgent escalation', audit.created_at, audit.admin_id, NULL
           FROM logistics_dispatch_escalations audit JOIN booking ON booking.id=audit.ride_id
         UNION ALL SELECT 'Automatic offer', attempt.offered_at, attempt.driver_profile_id, NULL
           FROM ride_dispatch_attempts attempt JOIN booking ON booking.id=attempt.ride_id
         UNION ALL SELECT 'Automatic offer '||attempt.status, attempt.responded_at, attempt.driver_profile_id, NULL
           FROM ride_dispatch_attempts attempt JOIN booking ON booking.id=attempt.ride_id
           WHERE attempt.responded_at IS NOT NULL
         UNION ALL SELECT 'Driver assigned', driver_accepted_at, assigned_driver_id, logistics_dispatch_source
           FROM booking WHERE driver_accepted_at IS NOT NULL
         UNION ALL SELECT CASE WHEN f.pickup_arrived_at<=booking.created_at+INTERVAL '30 minutes'
           THEN 'Pickup verified on time' ELSE 'Pickup verified late' END, f.pickup_arrived_at, booking.assigned_driver_id, NULL
           FROM logistics_pickup_fulfillment f JOIN booking ON booking.id=f.ride_id WHERE f.pickup_arrived_at IS NOT NULL
         UNION ALL SELECT 'Deadline missed', booking.created_at+INTERVAL '30 minutes', NULL, NULL
           FROM booking LEFT JOIN logistics_pickup_fulfillment f ON f.ride_id=booking.id
           WHERE booking.created_at+INTERVAL '30 minutes'<=statement_timestamp()
             AND (f.pickup_arrived_at IS NULL OR f.pickup_arrived_at>booking.created_at+INTERVAL '30 minutes')
             AND (booking.cancelled_at IS NULL OR booking.cancelled_at>booking.created_at+INTERVAL '30 minutes')
       ) SELECT * FROM activity ORDER BY at DESC LIMIT 100`,
      [id],
    );
    res.json({ success: true, data: rows });
  });
  router.post('/dispatch/:rideId/offers', async (req, res) => {
    const { driverId, vehicleId, kind } = z
      .object({
        driverId: z.string().uuid(),
        vehicleId: z.string().uuid(),
        kind: z.enum(['driver', 'fleet']).default('driver'),
      })
      .strict()
      .parse(req.body);
    const offer = await dispatch.offer(
      z.string().uuid().parse(req.params.rideId),
      req.auth!.userId,
      driverId,
      vehicleId,
      kind,
    );
    res.status(201).json({ success: true, data: offer });
  });
  router.post('/dispatch/:rideId/offers/:offerId/ring', async (req, res) => {
    const params = z
      .object({ rideId: z.string().uuid(), offerId: z.string().uuid() })
      .parse(req.params);
    res.json({
      success: true,
      data: await dispatch.ring(params.rideId, req.auth!.userId, params.offerId),
    });
  });
  router.get('/dispatch/:rideId/tracking', async (req, res) => {
    const id = z.string().uuid().parse(req.params.rideId);
    const { rows } = await pool.query(
      `SELECT v.id, v.plate_number AS "plateNumber", r.status, r.id AS "currentRideId",
        concat_ws(' ', u.first_name, u.last_name) AS "driverName",
        ST_Y(dp.last_location::geometry) AS latitude, ST_X(dp.last_location::geometry) AS longitude,
        dp.last_location_at AS "lastLocationAt", COALESCE(dp.last_location_at
          >=clock_timestamp()-($2::int * INTERVAL '1 second'),false) AS "locationFresh"
       FROM rides r JOIN vehicles v ON v.id=r.assigned_vehicle_id
       JOIN driver_profiles dp ON dp.id=r.assigned_driver_id JOIN users u ON u.id=dp.user_id
       WHERE r.id=$1 AND r.sector='logistics' AND r.status NOT IN ('completed','cancelled')`,
      [id, env.DRIVER_LOCATION_STALE_SECONDS],
    );
    res.json({ success: true, data: rows });
  });
  router.post('/dispatch/:rideId/escalate', async (req, res) => {
    const id = z.string().uuid().parse(req.params.rideId);
    const result = await pool.query(
      `WITH escalated AS (
         UPDATE rides SET logistics_escalated_at=COALESCE(logistics_escalated_at,clock_timestamp()),
           logistics_escalation_reason='admin_urgent'
         WHERE id=$1 AND sector='logistics' AND status NOT IN ('completed','cancelled')
           AND logistics_escalation_reason IS DISTINCT FROM 'admin_urgent'
         RETURNING id
       ) INSERT INTO logistics_dispatch_escalations (ride_id,admin_id) SELECT id,$2 FROM escalated`,
      [id, req.auth!.userId],
    );
    if (!result.rowCount)
      throw new AppError(
        'LOGISTICS_ESCALATION_CONFLICT',
        'Booking is already urgent or unavailable',
        409,
      );
    res.json({ success: true, data: { id } });
  });
  router.get('/dispatch-events', async (req, res) => {
    await new PostgresProviderOperationsRepository(pool).authorize(
      req.auth!.userId,
      req.auth!.role,
    );
    if (
      req.auth!.role !== 'super_admin' &&
      !['logistics.read', 'rides.read'].every((key) => res.locals.adminPermissions?.includes(key))
    )
      throw new AppError('FORBIDDEN', 'Logistics read permission required', 403);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    let pending: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      pending ??= setTimeout(() => {
        pending = undefined;
        if (!res.writableEnded) res.write('data: changed\n\n');
      }, 1000);
    };
    const unsubscribe = subscribeDispatch(invalidate);
    const duration = setTimeout(() => res.end(), 60000);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    res.once('close', () => {
      unsubscribe();
      clearTimeout(pending);
      clearTimeout(duration);
      clearInterval(heartbeat);
    });
  });
  router.get('/dispatch', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      await new PostgresProviderOperationsRepository(pool).authorize(
        req.auth!.userId,
        req.auth!.role,
      );
      if (
        req.auth!.role !== 'super_admin' &&
        !['logistics.read', 'rides.read'].every((key) => res.locals.adminPermissions?.includes(key))
      ) {
        res
          .status(403)
          .json({ success: false, error: { message: 'Logistics dispatch access required' } });
        return;
      }
      const query = z
        .object({
          search: z.string().trim().max(100).default(''),
          filter: z
            .enum([
              'all',
              'searching',
              'escalated',
              'assigned',
              'en_route',
              'urgent',
              'on_time',
              'late',
              'missed',
            ])
            .default('all'),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .strict()
        .parse(req.query);
      const { rows } = await pool.query(
        `WITH active AS (
           SELECT id, booking_id AS "bookingId", vehicle_category AS "category",
                  pickup_address AS "pickup", destination_address AS "destination",
                  status, rides.created_at AS "createdAt",
                  rides.created_at + INTERVAL '30 minutes' AS "deadline",
                  driver_accepted_at AS "assignedAt", logistics_dispatch_source AS "dispatchSource",
                  f.pickup_arrived_at AS "pickupArrivedAt", f.pickup_eta_at AS "pickupEtaAt",
                  f.delay_reason AS "delayReason",
                  EXTRACT(EPOCH FROM f.pickup_arrived_at-rides.created_at) AS "fulfillmentSeconds",
                  CASE
                    WHEN f.pickup_arrived_at <= rides.created_at + INTERVAL '30 minutes' THEN 'on_time'
                    WHEN f.pickup_arrived_at IS NOT NULL THEN 'late'
                    WHEN status<>'cancelled' AND statement_timestamp() >= rides.created_at + INTERVAL '30 minutes' THEN 'missed'
                    WHEN f.pickup_eta_at > rides.created_at + INTERVAL '30 minutes' THEN 'at_risk'
                    ELSE 'in_progress'
                  END AS "fulfillmentStatus",
                  logistics_escalated_at AS "escalatedAt",
                  logistics_escalation_reason AS "escalationReason",
                  dispatch_expires_at AS "offerExpiresAt",
                  assigned_driver_id AS "driverId", assigned_vehicle_id AS "vehicleId"
           FROM rides LEFT JOIN logistics_pickup_fulfillment f ON f.ride_id=rides.id
           WHERE sector = 'logistics' AND status<>'cancelled'
             AND (status<>'completed' OR f.pickup_arrived_at IS NOT NULL)
         ), filtered AS (
           SELECT * FROM active
           WHERE ($1 = '' OR strpos(lower(concat_ws(' ', "bookingId", category, pickup, destination)), lower($1)) > 0)
             AND CASE $2
               WHEN 'searching' THEN status IN ('requested', 'searching')
               WHEN 'escalated' THEN "escalatedAt" IS NOT NULL AND status<>'completed'
               WHEN 'assigned' THEN "driverId" IS NOT NULL AND status<>'completed'
               WHEN 'en_route' THEN status = 'driver_arriving'
               WHEN 'urgent' THEN "pickupArrivedAt" IS NULL AND ("escalationReason"='admin_urgent' OR "deadline"<=statement_timestamp()+($4::int*INTERVAL '1 minute'))
               WHEN 'all' THEN status<>'completed'
               ELSE "fulfillmentStatus"=$2
             END
         ), page AS (
           SELECT * FROM filtered
           ORDER BY ("driverId" IS NOT NULL), "deadline", id
           LIMIT 25 OFFSET $3
         )
         SELECT statement_timestamp() AS "serverTime",
                (SELECT count(*)::int FROM filtered) AS total,
                (SELECT jsonb_build_object(
                  'all', count(*) FILTER (WHERE status<>'completed'),
                  'searching', count(*) FILTER (WHERE status IN ('requested', 'searching')),
                  'escalated', count(*) FILTER (WHERE "escalatedAt" IS NOT NULL AND status<>'completed'),
                  'assigned', count(*) FILTER (WHERE "driverId" IS NOT NULL AND status<>'completed'),
                  'en_route', count(*) FILTER (WHERE status = 'driver_arriving'),
                  'urgent', count(*) FILTER (WHERE "pickupArrivedAt" IS NULL AND ("escalationReason"='admin_urgent' OR "deadline"<=statement_timestamp()+($4::int*INTERVAL '1 minute'))),
                  'on_time', count(*) FILTER (WHERE "fulfillmentStatus"='on_time'),
                  'late', count(*) FILTER (WHERE "fulfillmentStatus"='late'),
                  'missed', count(*) FILTER (WHERE "fulfillmentStatus"='missed')
                ) FROM active) AS counts,
                (SELECT COALESCE(jsonb_agg(page ORDER BY ("driverId" IS NOT NULL), "deadline", id), '[]')
                 FROM page) AS items`,
        [query.search, query.filter, query.offset, env.LOGISTICS_URGENT_MINUTES],
      );
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      next(error);
    }
  });
  router.get('/payments', async (req, res, next) => {
    try {
      await new PostgresProviderOperationsRepository(pool).authorize(
        req.auth!.userId,
        req.auth!.role,
      );
      const q = z
        .object({
          vehicle: z.string().max(50).optional(),
          method: z.enum(['cash', 'cashfree']).optional(),
          paymentStatus: z
            .enum(['INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'])
            .optional(),
          deliveryStatus: z
            .enum([
              'requested',
              'searching',
              'driver_assigned',
              'driver_arriving',
              'driver_arrived',
              'in_progress',
              'completed',
              'cancelled',
            ])
            .optional(),
          settlement: z.enum(['settled', 'outstanding']).optional(),
          from: z.string().date().optional(),
          to: z.string().date().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .strict()
        .refine((q) => !q.from || !q.to || q.from <= q.to, 'Invalid date range')
        .parse(req.query);
      const result = await pool.query(
        `WITH ledger AS (
 SELECT r.id,r.vehicle_category AS "vehicleType",r.customer_id AS "customerId",concat_ws(' ',cu.first_name,cu.last_name) AS "customerName",r.assigned_driver_id AS "driverId",provider_public_id(du.id) AS "driverPublicId",concat_ws(' ',du.first_name,du.last_name) AS "driverName",r.status AS "deliveryStatus",r.created_at AS "createdAt",r.completed_at AS "deliveredAt",lp.currency,lp.total_paise AS "totalPaise",lp.upfront_paise AS "upfrontPaise",lp.final_paise AS "finalPaise",
 COALESCE((SELECT sum(round(p.amount*100)) FROM payments p WHERE p.ride_id=r.id AND p.status='CAPTURED'),0) AS "confirmedPaise",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'stage',p.payment_stage,'method',p.provider,'status',p.status,'amountPaise',round(p.amount*100),'customerClaimedAt',p.customer_claimed_at,'cashConfirmedBy',p.cash_confirmed_by,'cashConfirmedAt',p.cash_confirmed_at,'providerOrderId',p.provider_order_id,'providerPaymentId',p.provider_payment_id,'confirmedAt',p.captured_at) ORDER BY p.created_at) FROM payments p WHERE p.ride_id=r.id),'[]'::jsonb) AS payments
 FROM rides r JOIN logistics_ride_payment_plans lp ON lp.ride_id=r.id JOIN users cu ON cu.id=r.customer_id LEFT JOIN driver_profiles dp ON dp.id=r.assigned_driver_id LEFT JOIN users du ON du.id=dp.user_id
 WHERE r.sector='logistics' AND ($1::text IS NULL OR r.vehicle_category=$1) AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM payments p WHERE p.ride_id=r.id AND p.provider=$2)) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM payments p WHERE p.ride_id=r.id AND p.status::text=$3)) AND ($4::text IS NULL OR r.status::text=$4) AND ($5::date IS NULL OR r.created_at>=($5::date::timestamp AT TIME ZONE 'Asia/Kolkata')) AND ($6::date IS NULL OR r.created_at<(($6::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
 ), filtered AS (SELECT *,GREATEST(0,"totalPaise"-"confirmedPaise") AS "outstandingPaise",CASE WHEN "confirmedPaise">="totalPaise" THEN 'settled' ELSE 'outstanding' END AS "settlementStatus" FROM ledger)
 SELECT *,count(*) OVER() AS "totalCount" FROM filtered WHERE ($7::text IS NULL OR "settlementStatus"=$7) ORDER BY "createdAt" DESC,id DESC LIMIT $8 OFFSET $9`,
        [
          q.vehicle ?? null,
          q.method ?? null,
          q.paymentStatus ?? null,
          q.deliveryStatus ?? null,
          q.from ?? null,
          q.to ?? null,
          q.settlement ?? null,
          q.limit,
          q.offset,
        ],
      );
      res.json({
        success: true,
        data: {
          items: result.rows,
          total: Number(result.rows[0]?.totalCount ?? 0),
          limit: q.limit,
          offset: q.offset,
        },
      });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
