import type { Pool } from 'pg';

export async function recordDestinationArrival(pool: Pool, rideId: string, profileId: string) {
  for (const seconds of [3, 1]) {
    await pool.query(
      `UPDATE driver_profiles dp SET last_location=r.destination_location,
         last_location_at=NOW()-($3::int*INTERVAL '1 second'), location_accuracy=8
       FROM rides r WHERE r.id=$1 AND dp.id=$2`,
      [rideId, profileId, seconds],
    );
  }
}
