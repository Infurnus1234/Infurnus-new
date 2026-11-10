import type { Pool } from 'pg';
import { pool } from '../../../infrastructure/database/postgres.js';
import { env } from '../../../config/env.js';
/** Event counts for the configured local calendar day, never rolling 24-hour or lifetime values. */
export class DriverTodaySummaryRepository {
  constructor(
    private readonly db: Pool = pool,
    private readonly timeZone = env.FLEET_REPORT_TIME_ZONE,
  ) {}
  async get(driverProfileId: string, now: Date = new Date()) {
    const result = await this.db.query(
      `WITH bounds AS (
      SELECT ($3::timestamptz AT TIME ZONE $2)::date AS day,
        date_trunc('day',$3::timestamptz AT TIME ZONE $2) AT TIME ZONE $2 AS starts,
        (date_trunc('day',$3::timestamptz AT TIME ZONE $2)+INTERVAL '1 day') AT TIME ZONE $2 AS ends
    ) SELECT day::text AS date, $2::text AS "timeZone", starts AS "startsAt", ends AS "endsAt",
      (SELECT count(*)::int FROM ride_dispatch_attempts a WHERE a.driver_profile_id=$1 AND a.offered_at>=starts AND a.offered_at<ends) AS "totalRequests",
      (SELECT count(*)::int FROM ride_dispatch_attempts a WHERE a.driver_profile_id=$1 AND a.status='accepted' AND a.responded_at>=starts AND a.responded_at<ends) AS accepted,
      (SELECT count(*)::int FROM ride_dispatch_attempts a WHERE a.driver_profile_id=$1 AND a.status='rejected' AND a.responded_at>=starts AND a.responded_at<ends) AS rejected,
      (SELECT count(*)::int FROM rides r WHERE r.assigned_driver_id=$1 AND r.status='completed' AND r.completed_at>=starts AND r.completed_at<ends) AS "totalRides"
      FROM bounds`,
      [driverProfileId, this.timeZone, now],
    );
    return result.rows[0];
  }
}
