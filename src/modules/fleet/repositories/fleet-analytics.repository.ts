import type { PoolClient } from 'pg';
import { env } from '../../../config/env.js';
import type { RevenueFilter } from './fleet-revenue.repository.js';

// One historical job per (kind,id). Aggregate payment attempts/refunds before
// joining so event retries and multiple receipts cannot multiply trip metrics.
export const fleetActivitySql = `WITH owned_vehicles AS (
 SELECT v.* FROM vehicles v WHERE owner_id=$1 AND ($2::uuid IS NULL OR id=$2)
), raw_jobs AS (
 SELECT 'ride'::text AS kind,r.id,r.assigned_vehicle_id AS vehicle_id,r.status::text,
 COALESCE(r.completed_at,r.cancelled_at,r.created_at) AS activity_at,r.completed_at,
 r.final_fare*100 AS fare, r.commission_amount*100 AS commission,
 NULLIF(r.actual_distance_meters,0) AS distance,
 NULL::bigint AS seconds
 FROM rides r JOIN owned_vehicles v ON v.id=r.assigned_vehicle_id
 UNION ALL
 SELECT 'rental',r.id,r.vehicle_id,lower(r.status::text),COALESCE(r.completed_at,r.cancelled_at,r.created_at),r.completed_at,
 CASE WHEN r.currency='INR' THEN r.total_amount*100 END,NULL::numeric,NULL::integer,NULL::bigint
 FROM rentals r JOIN owned_vehicles v ON v.id=r.vehicle_id
), jobs AS MATERIALIZED (
 SELECT *, (activity_at AT TIME ZONE $5)::date AS activity_date FROM raw_jobs WHERE ($3::timestamptz IS NULL OR activity_at >= $3)
 AND ($4::timestamptz IS NULL OR activity_at < $4)
), selected_payments AS (
 SELECT p.*,j.kind,j.id AS job_id FROM payments p JOIN jobs j ON j.kind='ride' AND p.ride_id=j.id WHERE p.currency='INR'
 UNION ALL
 SELECT p.*,j.kind,j.id AS job_id FROM payments p JOIN jobs j ON j.kind='rental' AND p.rental_id=j.id WHERE p.currency='INR'
), refunds AS (
 SELECT r.payment_id,SUM(r.amount) AS amount FROM payment_refunds r
 JOIN selected_payments p ON p.id=r.payment_id WHERE r.currency='INR' AND r.status IN ('SUCCESS','SUCCEEDED','COMPLETED') GROUP BY r.payment_id
), money AS (
 SELECT p.kind,p.job_id,
 COALESCE(SUM(p.amount*100) FILTER(WHERE p.status IN ('CAPTURED','REFUNDED')),0) AS captured,
 COALESCE(SUM(100*CASE WHEN p.status='REFUNDED' THEN p.amount ELSE LEAST(p.amount,COALESCE(r.amount,0)) END) FILTER(WHERE p.status IN ('CAPTURED','REFUNDED')),0) AS refunded,
 COALESCE(SUM(p.amount*100) FILTER(WHERE p.status IN ('INITIATED','AUTHORIZED')),0) AS pending,
 COALESCE(SUM(p.amount*100) FILTER(WHERE p.status='FAILED'),0) AS failed,
 COUNT(*)::int AS attempts
 FROM selected_payments p LEFT JOIN refunds r ON r.payment_id=p.id GROUP BY p.kind,p.job_id
), activity AS (
 SELECT j.*,COALESCE(m.captured,0) AS captured,COALESCE(m.refunded,0) AS refunded,
 COALESCE(m.pending,0) AS pending,COALESCE(m.failed,0) AS failed,COALESCE(m.attempts,0) AS payment_attempts
 FROM jobs j LEFT JOIN money m ON m.kind=j.kind AND m.job_id=j.id
)
`;
const sums = `ROUND(SUM(captured-refunded) FILTER(WHERE status='completed')/NULLIF(COUNT(*) FILTER(WHERE status='completed'),0),0)::text AS "averageCollectedPerCompletedTripPaise",
 COUNT(*) FILTER(WHERE status='completed')::int AS "completedTrips",
 COUNT(*) FILTER(WHERE status='cancelled')::int AS "cancelledTrips",COUNT(*)::int AS "totalJobs",
 COALESCE(SUM(fare) FILTER(WHERE status='completed'),0)::numeric(24,0)::text AS "grossFarePaise",
 COUNT(*) FILTER(WHERE status='completed' AND fare IS NULL)::int AS "missingFareTrips",
 COALESCE(SUM(captured) FILTER(WHERE status='completed'),0)::numeric(24,0)::text AS "capturedPaise",
 COALESCE(SUM(refunded) FILTER(WHERE status='completed'),0)::numeric(24,0)::text AS "refundPaise",
 COALESCE(SUM(captured-refunded) FILTER(WHERE status='completed'),0)::numeric(24,0)::text AS "collectedAfterRefundsPaise",
 COALESCE(SUM(commission) FILTER(WHERE status='completed'),0)::numeric(24,0)::text AS "recordedRideCommissionPaise",
 COUNT(*) FILTER(WHERE status='completed' AND commission IS NOT NULL)::int AS "commissionCoveredTrips",
 COALESCE(SUM(pending),0)::numeric(24,0)::text AS "pendingAttemptPaise",
 COALESCE(SUM(failed),0)::numeric(24,0)::text AS "failedAttemptPaise",
 SUM(distance) FILTER(WHERE status='completed')::text AS "knownDistanceMeters",
 COUNT(*) FILTER(WHERE status='completed' AND distance IS NOT NULL)::int AS "distanceCoveredTrips",
 SUM(seconds) FILTER(WHERE status='completed')::text AS "knownOperatingSeconds",
 COUNT(*) FILTER(WHERE status='completed' AND seconds IS NOT NULL)::int AS "timeCoveredTrips",
 ROUND(100.0*COUNT(*) FILTER(WHERE status='cancelled')/NULLIF(COUNT(*),0),2)::text AS "cancellationRatePercent",
 ROUND(AVG(fare) FILTER(WHERE status='completed'),0)::text AS "averageGrossFarePaise",
 COUNT(*) FILTER(WHERE status='completed' AND (completed_at AT TIME ZONE $5)::date=(NOW() AT TIME ZONE $5)::date)::int AS "completedToday",
 COUNT(*) FILTER(WHERE status='completed' AND date_trunc('week',completed_at AT TIME ZONE $5)=date_trunc('week',NOW() AT TIME ZONE $5))::int AS "completedThisWeek",
 COUNT(*) FILTER(WHERE status='completed' AND date_trunc('month',completed_at AT TIME ZONE $5)=date_trunc('month',NOW() AT TIME ZONE $5))::int AS "completedThisMonth"`;

export async function fleetAnalytics(c: PoolClient, owner: string, filter: RevenueFilter) {
  const period = filter.period ?? (filter.from || filter.to ? 'custom' : 'all_time');
  const zone = env.FLEET_REPORT_TIME_ZONE;
  const bounds = (
    await c.query(
      `WITH local AS (SELECT (NOW() AT TIME ZONE $1)::date AS today), dates AS (
 SELECT CASE $2::text WHEN 'today' THEN today WHEN 'this_week' THEN date_trunc('week',today)::date
 WHEN 'this_month' THEN date_trunc('month',today)::date ELSE $3::date END AS first,
 CASE WHEN $2 IN ('today','this_week','this_month') THEN today ELSE $4::date END AS last FROM local)
 SELECT first::text AS "from",last::text AS "to",first::timestamp AT TIME ZONE $1 AS start,
 (last+1)::timestamp AT TIME ZONE $1 AS "endExclusive" FROM dates`,
      [zone, period, filter.from ?? null, filter.to ?? null],
    )
  ).rows[0]!;
  const args = [owner, filter.vehicleId ?? null, bounds.start, bounds.endExclusive, zone];
  const limit = filter.limit ?? 25,
    ho = filter.historyOffset ?? 0,
    vo = filter.vehicleOffset ?? 0,
    to = filter.trendOffset ?? 0;
  const inventory = (
    await c.query(
      `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE is_active)::int AS active,
 COUNT(*) FILTER(WHERE NOT is_active)::int AS inactive,
 COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM rides r WHERE r.assigned_vehicle_id=v.id AND r.status='in_progress')
 OR EXISTS(SELECT 1 FROM rentals r WHERE r.vehicle_id=v.id AND r.status='ACTIVE'))::int AS operating
 FROM vehicles v WHERE owner_id=$1 AND ($2::uuid IS NULL OR id=$2)`,
      args.slice(0, 2),
    )
  ).rows[0]!;
  const summary = (await c.query(fleetActivitySql + 'SELECT ' + sums + ' FROM activity', args))
    .rows[0]!;
  const status = (
    await c.query(
      fleetActivitySql +
        'SELECT status,COUNT(*)::int AS count FROM activity GROUP BY status ORDER BY status',
      args,
    )
  ).rows;
  const vehicles = (
    await c.query(
      fleetActivitySql +
        `, totals AS (SELECT vehicle_id,${sums} FROM activity GROUP BY vehicle_id)
 SELECT v.id AS "vehicleId",v.plate_number AS "plateNumber",v.make,v.model,v.is_active AS active,
 d.user_id AS "assignedDriverId",u.first_name AS "assignedDriverFirstName",u.last_name AS "assignedDriverLastName",
 COALESCE(t."completedTrips",0) AS "completedTrips",COALESCE(t."grossFarePaise",'0') AS "grossFarePaise",
 COALESCE(t."collectedAfterRefundsPaise",'0') AS "collectedAfterRefundsPaise",t."knownDistanceMeters",t."knownOperatingSeconds"
 FROM owned_vehicles v LEFT JOIN totals t ON t.vehicle_id=v.id
 LEFT JOIN driver_profiles d ON d.id=v.driver_profile_id LEFT JOIN users u ON u.id=d.user_id AND u.deleted_at IS NULL
 ORDER BY v.created_at,v.id LIMIT $6 OFFSET $7`,
      [...args, limit, vo],
    )
  ).rows;
  const history = (
    await c.query(
      fleetActivitySql +
        `SELECT id,kind,vehicle_id AS "vehicleId",status,activity_at AS "activityAt",
 fare::numeric(24,0)::text AS "farePaise",captured::numeric(24,0)::text AS "capturedPaise",
 refunded::numeric(24,0)::text AS "refundPaise",pending::numeric(24,0)::text AS "pendingAttemptPaise",
 failed::numeric(24,0)::text AS "failedAttemptPaise",payment_attempts AS "paymentAttempts",
 distance AS "distanceMeters",seconds::text AS "operatingSeconds"
 FROM activity ORDER BY activity_at DESC,kind,id DESC LIMIT $6 OFFSET $7`,
      [...args, limit, ho],
    )
  ).rows;
  const trends = (
    await c.query(
      fleetActivitySql +
        `SELECT date_trunc($6,activity_at AT TIME ZONE $5)::date::text AS date,
 COUNT(*) FILTER(WHERE status='completed')::int AS "completedTrips",
 COALESCE(SUM(fare) FILTER(WHERE status='completed'),0)::numeric(24,0)::text AS "grossFarePaise",
 COALESCE(SUM(captured-refunded) FILTER(WHERE status='completed'),0)::numeric(24,0)::text AS "collectedAfterRefundsPaise",
 COUNT(*) OVER()::int AS "bucketCount" FROM activity GROUP BY 1 ORDER BY 1 DESC LIMIT $7 OFFSET $8`,
      [...args, filter.interval ?? 'day', limit, to],
    )
  ).rows;
  const trendTotal =
    trends[0]?.bucketCount ??
    (to > 0
      ? (
          await c.query(
            fleetActivitySql +
              `SELECT COUNT(DISTINCT date_trunc($6,activity_at AT TIME ZONE $5))::int AS total FROM activity`,
            [...args, filter.interval ?? 'day'],
          )
        ).rows[0]!.total
      : 0);
  return {
    currency: 'INR',
    timeZone: zone,
    period: {
      name: period,
      ...bounds,
      basis: 'Completion date; cancelled date; otherwise request creation date. End exclusive.',
    },
    inventory,
    summary: {
      ...summary,
      averageTripsPerVehicle: inventory.total ? summary.completedTrips / inventory.total : null,
      ownerNetEarningsPaise: null,
      settledPaise: null,
      adjustmentsPaise: null,
    },
    status,
    vehicles,
    history,
    trends,
    pagination: {
      limit,
      history: { offset: ho, total: summary.totalJobs },
      vehicles: { offset: vo, total: inventory.total },
      trends: { offset: to, total: trendTotal },
    },
    availability: {
      fare: 'Known final INR fares only. Missing final fares are excluded and counted separately; totals are partial when missingFareTrips is positive.',
      ownerNetEarnings:
        'Unavailable: user wallet/payout entries have no enforced job/vehicle allocation.',
      settlement:
        'Captured customer payments are not owner settlements. Vehicle settlement, reversals and other adjustments cannot be allocated reliably.',
      distance:
        'Positive recorded ride distance only; zero defaults and rentals are unknown. Covered trip counts identify partial totals.',
      operatingTime:
        'Unavailable: no authoritative ride start timestamp is persisted. Estimated route ETA and scheduled rental duration are excluded.',
      payments:
        'Pending/failed amounts describe attempts, not balances due or earnings. Multiple genuine captured payments are summed once per receipt.',
      attribution:
        'Historical recorded vehicle ID; current authorized vehicle inventory. Unassigned jobs and unlinked logistics receipts cannot be attributed.',
    },
  };
}
