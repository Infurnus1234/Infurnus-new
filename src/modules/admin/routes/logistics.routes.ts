import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
export function createLogisticsAdminRouter(pool: Pool) {
  const router = Router();
  router.use(requireAuth, requireRoles('admin', 'super_admin'));
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
