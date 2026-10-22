import { env } from '../../../config/env.js';
import { revenueSql } from '../../fleet/repositories/fleet-revenue.repository.js';
import type { Pool } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
export class FleetFinancialReportRepository {
  constructor(private readonly pool: Pool) {}
  async report(owner: string, role: string, month: string) {
    if (
      !['fleet_owner', 'driver_fleet_owner'].includes(role) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    )
      throw new AppError(
        'INVALID_FLEET_REPORT',
        'Fleet role and a YYYY-MM reporting month are required',
        400,
      );
    const actor = await this.pool.query(
      "SELECT id FROM users WHERE id=$1 AND role::text=$2 AND status='active' AND deleted_at IS NULL",
      [owner, role],
    );
    if (!actor.rowCount) throw new AppError('FORBIDDEN', 'Active Fleet Owner required', 403);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const date = month + '-01';
      const trips = (
        await c.query(
          `SELECT COUNT(*) FILTER(WHERE r.created_at >= ($2::date::timestamp AT TIME ZONE $3) AND r.created_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3))::int AS bookings,
    COUNT(*) FILTER(WHERE r.status='completed' AND r.completed_at >= ($2::date::timestamp AT TIME ZONE $3) AND r.completed_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3))::int AS completed_trips,
    COUNT(*) FILTER(WHERE r.status='completed' AND r.completed_at >= ($2::date::timestamp AT TIME ZONE $3) AND r.completed_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3) AND r.final_fare IS NULL)::int AS missing_final_fares,
    COALESCE(SUM(r.final_fare) FILTER(WHERE r.status='completed' AND r.completed_at >= ($2::date::timestamp AT TIME ZONE $3) AND r.completed_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3)),0)::text AS final_fare_revenue
    FROM rides r JOIN vehicles v ON v.id=r.assigned_vehicle_id WHERE v.owner_id=$1`,
          [owner, date, env.FLEET_REPORT_TIME_ZONE],
        )
      ).rows[0];
      const collections = (
        await c.query(
          `SELECT COALESCE(SUM(pay.amount) FILTER(WHERE pay.status='CAPTURED' AND pay.captured_at >= ($2::date::timestamp AT TIME ZONE $3) AND pay.captured_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3)),0)::text AS captured_payments,
    COALESCE(SUM(pay.amount) FILTER(WHERE pay.status IN ('INITIATED','AUTHORIZED')),0)::text AS unsettled_payment_amount,
    COUNT(*) FILTER(WHERE pay.status IN ('INITIATED','AUTHORIZED'))::int AS unsettled_payment_records
    FROM payments pay JOIN rides r ON r.id=pay.ride_id JOIN vehicles v ON v.id=r.assigned_vehicle_id WHERE v.owner_id=$1 AND pay.currency='INR'`,
          [owner, date, env.FLEET_REPORT_TIME_ZONE],
        )
      ).rows[0];
      const ledger = (
        await c.query(
          `SELECT COALESCE(SUM(amount_paise) FILTER(WHERE entry_type='EARNING'),0)::text AS earnings_paise,
    COALESCE(-SUM(amount_paise) FILTER(WHERE entry_type='COMMISSION'),0)::text AS commission_paise,
    COALESCE(SUM(amount_paise) FILTER(WHERE entry_type IN ('EARNING','COMMISSION','ADJUSTMENT')),0)::text AS net_ledger_paise
    FROM provider_wallet_entries WHERE user_id=$1 AND created_at >= ($2::date::timestamp AT TIME ZONE $3) AND created_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3)`,
          [owner, date, env.FLEET_REPORT_TIME_ZONE],
        )
      ).rows[0];
      const payouts = (
        await c.query(
          `SELECT COALESCE(SUM(amount_paise) FILTER(WHERE status IN ('PENDING','PROCESSING')),0)::text AS pending_payout_paise,
    COALESCE(SUM(amount_paise) FILTER(WHERE status='SUCCESS' AND updated_at >= ($2::date::timestamp AT TIME ZONE $3) AND updated_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3)),0)::text AS paid_payout_paise
    FROM provider_payouts WHERE user_id=$1`,
          [owner, date, env.FLEET_REPORT_TIME_ZONE],
        )
      ).rows[0];
      const history = (
        await c.query(
          `SELECT status,amount::text,currency,captured_at,created_at FROM payments pay WHERE currency='INR' AND EXISTS(SELECT 1 FROM rides r JOIN vehicles v ON v.id=r.assigned_vehicle_id WHERE r.id=pay.ride_id AND v.owner_id=$1) AND pay.created_at >= ($2::date::timestamp AT TIME ZONE $3) AND pay.created_at < (($2::date+INTERVAL '1 month') AT TIME ZONE $3) ORDER BY pay.created_at DESC LIMIT 100`,
          [owner, date, env.FLEET_REPORT_TIME_ZONE],
        )
      ).rows;
      const end = (
        await c.query("SELECT ($1::date+INTERVAL '1 month'-INTERVAL '1 day')::date::text AS day", [
          date,
        ])
      ).rows[0].day;
      const revenue = (
        await c.query(
          revenueSql +
            `SELECT COALESCE(SUM(gross),0)::text AS "grossRevenuePaise",COALESCE(SUM(refunded),0)::text AS "refundPaise",COALESCE(SUM(gross-refunded),0)::text AS "netRevenuePaise" FROM owned`,
          [owner, null, date, end, env.FLEET_REPORT_TIME_ZONE],
        )
      ).rows[0];
      await c.query('COMMIT');
      return {
        month,
        currency: 'INR',
        timeZone: env.FLEET_REPORT_TIME_ZONE,
        ...revenue,
        ...trips,
        ...collections,
        ...ledger,
        ...payouts,
        paymentHistory: history,
      };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
