import type { Pool } from 'pg';

export async function recordDestinationArrival(pool: Pool, rideId: string, profileId: string) {
  for (let sample = 0; sample < 2; sample++) {
    await pool.query(
      `UPDATE driver_profiles dp SET last_location=r.destination_location,
         last_location_at=clock_timestamp(), location_accuracy=8
       FROM rides r WHERE r.id=$1 AND dp.id=$2`,
      [rideId, profileId],
    );
  }
}
