import type { Pool } from 'pg';
import { fleetAnalytics } from './fleet-analytics.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
export interface RevenueFilter {
  period?: 'today' | 'this_week' | 'this_month' | 'custom' | 'all_time' | undefined;
  interval?: 'day' | 'week' | 'month' | undefined;
  limit?: number | undefined;
  historyOffset?: number | undefined;
  vehicleOffset?: number | undefined;
  trendOffset?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  vehicleId?: string | undefined;
}

// Each payment and refund is aggregated once before joining a completed job.
// Monetary sums stay NUMERIC/integer paise; no estimated fare becomes paid revenue.
export const revenueSql = `WITH successful_refunds AS (
 SELECT payment_id,SUM(amount) AS amount FROM payment_refunds WHERE status IN ('SUCCESS','SUCCEEDED','COMPLETED') AND currency='INR' GROUP BY payment_id
),receipts AS (
 SELECT pay.id,pay.ride_id,pay.rental_id,pay.captured_at,
 (pay.amount*100)::numeric(24,0) AS gross,
 (CASE WHEN pay.status='REFUNDED' THEN pay.amount ELSE LEAST(pay.amount,COALESCE(ref.amount,0)) END*100)::numeric(24,0) AS refunded
 FROM payments pay LEFT JOIN successful_refunds ref ON ref.payment_id=pay.id
 WHERE pay.status IN ('CAPTURED','REFUNDED') AND pay.currency='INR'
),jobs AS (
 SELECT 'ride' AS kind,r.id,receipt.id AS receipt_id,r.assigned_vehicle_id AS vehicle_id,r.completed_at,
 GREATEST(r.completed_at,receipt.captured_at) AS earned_at,receipt.gross,receipt.refunded
 FROM rides r JOIN receipts receipt ON receipt.ride_id=r.id WHERE r.status='completed' AND r.completed_at IS NOT NULL
 UNION ALL
 SELECT 'rental',r.id,receipt.id,r.vehicle_id,r.completed_at,GREATEST(r.completed_at,receipt.captured_at),receipt.gross,receipt.refunded
 FROM rentals r JOIN receipts receipt ON receipt.rental_id=r.id WHERE r.status='COMPLETED' AND r.completed_at IS NOT NULL
),owned AS (
 SELECT jobs.*,v.make,v.model,v.plate_number,v.sector,v.category FROM jobs JOIN vehicles v ON v.id=jobs.vehicle_id
 WHERE v.owner_id=$1 AND ($2::uuid IS NULL OR v.id=$2)
 AND ($3::date IS NULL OR (jobs.earned_at AT TIME ZONE $5)::date >= $3::date)
 AND ($4::date IS NULL OR (jobs.earned_at AT TIME ZONE $5)::date <= $4::date)
)
`;
export class FleetRevenueRepository {
  constructor(private readonly pool: Pool) {}
  async report(owner: string, filter: RevenueFilter = {}) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (
        !(
          await c.query(
            "SELECT id FROM users WHERE id=$1 AND role IN ('fleet_owner','driver_fleet_owner') AND status='active' AND deleted_at IS NULL",
            [owner],
          )
        ).rowCount
      )
        throw new AppError('FORBIDDEN', 'Active Fleet Owner financial access required', 403);
      if (
        filter.vehicleId &&
        !(
          await c.query('SELECT id FROM vehicles WHERE id=$1 AND owner_id=$2', [
            filter.vehicleId,
            owner,
          ])
        ).rowCount
      )
        throw new AppError('VEHICLE_NOT_FOUND', 'Owned vehicle not found', 404);
      const analytics = await fleetAnalytics(c, owner, filter);
      const args = [
        owner,
        filter.vehicleId ?? null,
        analytics.period.from,
        analytics.period.to,
        env.FLEET_REPORT_TIME_ZONE,
      ];
      const sums = `COUNT(DISTINCT (kind,id)) FILTER(WHERE gross>refunded)::int AS "completedJobs",COALESCE(SUM(gross),0)::text AS "grossRevenuePaise",COALESCE(SUM(refunded),0)::text AS "refundPaise",
    COALESCE(SUM(gross-refunded),0)::text AS "netRevenuePaise",
    COALESCE(SUM(gross-refunded) FILTER(WHERE (earned_at AT TIME ZONE $5)::date=(NOW() AT TIME ZONE $5)::date),0)::text AS "todayRevenuePaise",
    COALESCE(SUM(gross-refunded) FILTER(WHERE date_trunc('week',earned_at AT TIME ZONE $5)=date_trunc('week',NOW() AT TIME ZONE $5)),0)::text AS "weekRevenuePaise",
    COALESCE(SUM(gross-refunded) FILTER(WHERE date_trunc('month',earned_at AT TIME ZONE $5)=date_trunc('month',NOW() AT TIME ZONE $5)),0)::text AS "monthRevenuePaise"`;
      const summary = (await c.query(revenueSql + 'SELECT ' + sums + ' FROM owned', args)).rows[0];
      const paid = (
        await c.query(
          revenueSql +
            'SELECT vehicle_id AS "vehicleId",' +
            sums +
            ' FROM owned WHERE vehicle_id IN (SELECT id FROM vehicles WHERE owner_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at,id LIMIT $6 OFFSET $7) GROUP BY vehicle_id',
          [...args, filter.limit ?? 25, filter.vehicleOffset ?? 0],
        )
      ).rows;
      const inventory = (
        await c.query(
          `SELECT id AS "vehicleId",make,model,plate_number AS "plateNumber",sector,category
    FROM vehicles WHERE owner_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at,id LIMIT $3 OFFSET $4`,
          [owner, filter.vehicleId ?? null, filter.limit ?? 25, filter.vehicleOffset ?? 0],
        )
      ).rows;
      const vehicles = inventory.map((v) => ({
        ...v,
        ...(paid.find((p) => p.vehicleId === v.vehicleId) ?? {
          completedJobs: 0,
          grossRevenuePaise: '0',
          refundPaise: '0',
          netRevenuePaise: '0',
          todayRevenuePaise: '0',
          monthRevenuePaise: '0',
          weekRevenuePaise: '0',
        }),
      }));
      const history = (
        await c.query(
          revenueSql +
            `SELECT id,receipt_id AS "paymentId",kind,vehicle_id AS "vehicleId",earned_at AS "earnedAt",gross::text AS "grossRevenuePaise",refunded::text AS "refundPaise",(gross-refunded)::text AS "netRevenuePaise" FROM owned ORDER BY earned_at DESC,id DESC LIMIT $6 OFFSET $7`,
          [...args, filter.limit ?? 25, filter.historyOffset ?? 0],
        )
      ).rows;
      await c.query('COMMIT');
      return {
        analytics,
        currency: 'INR',
        timeZone: env.FLEET_REPORT_TIME_ZONE,
        period: { from: analytics.period.from, to: analytics.period.to },
        summary,
        vehicles,
        history,
        accountingBasis:
          'Completed ride/rental jobs with captured INR payments; successful refunds deducted. Driver payouts and commissions remain separate ledger entries.',
        coverage:
          'Ride-based passenger, logistics, service and premium jobs plus linked rentals. Unlinked logistics-order receipts cannot be attributed to a vehicle.',
      };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

// Scalar amount in rupees for legacy Fleet-only performance rows. Payments and
// refunds are aggregated before joining, so multiple evidence rows cannot inflate it.
export const paidRideRevenueSql = `(SELECT COALESCE(SUM(CASE WHEN pay.status='REFUNDED' THEN 0 ELSE
 pay.amount-LEAST(pay.amount,COALESCE((SELECT SUM(ref.amount) FROM payment_refunds ref WHERE ref.payment_id=pay.id
 AND ref.currency='INR' AND ref.status IN ('SUCCESS','SUCCEEDED','COMPLETED')),0)) END),0)
 FROM payments pay WHERE pay.ride_id=r.id AND pay.currency='INR' AND pay.status IN ('CAPTURED','REFUNDED'))`;
