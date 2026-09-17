import type { Pool } from 'pg';
import type { CreateRatingData, DriverRatingSummary, Rating } from '../types/rating.js';

export interface RatingRepository {
  create(data: CreateRatingData): Promise<Rating>;
  findByRideId(rideId: string): Promise<Rating | null>;
  getDriverSummary(driverProfileId: string): Promise<DriverRatingSummary>;
}

const ratingProjection = `
  id, ride_id AS "rideId", customer_id AS "customerId",
  driver_profile_id AS "driverProfileId", rating, review,
  created_at AS "createdAt"`;

export class PostgresRatingRepository implements RatingRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreateRatingData): Promise<Rating> {
    // If driverProfileId is not provided, look it up from the ride
    let driverProfileId = data.driverProfileId;
    if (!driverProfileId) {
      const rideRes = await this.pool.query(
        'SELECT assigned_driver_id FROM rides WHERE id = $1',
        [data.rideId],
      );
      driverProfileId = rideRes.rows[0]?.assigned_driver_id;
    }

    if (!driverProfileId) {
      throw new Error('Cannot rate a ride with no assigned driver');
    }

    const result = await this.pool.query<Rating>(
      `INSERT INTO ratings (ride_id, customer_id, driver_profile_id, rating, review)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ride_id) DO UPDATE
       SET rating = EXCLUDED.rating, review = EXCLUDED.review
       RETURNING ${ratingProjection}`,
      [data.rideId, data.customerId, driverProfileId, data.rating, data.review ?? null],
    );

    const rating = result.rows[0];
    if (!rating) throw new Error('Failed to create rating');
    return rating;
  }

  async findByRideId(rideId: string): Promise<Rating | null> {
    const result = await this.pool.query<Rating>(
      `SELECT ${ratingProjection} FROM ratings WHERE ride_id = $1`,
      [rideId],
    );
    return result.rows[0] ?? null;
  }

  async getDriverSummary(driverProfileId: string): Promise<DriverRatingSummary> {
    const result = await this.pool.query<{ average: string | null; count: string }>(
      `SELECT AVG(rating) AS average, COUNT(*)::text AS count
       FROM ratings
       WHERE driver_profile_id = $1`,
      [driverProfileId],
    );

    const row = result.rows[0];
    const avg = row?.average != null ? Number(row.average) : 4.9;
    const total = row?.count != null ? Number.parseInt(row.count, 10) : 0;

    return {
      driverProfileId,
      averageRating: Math.round(avg * 10) / 10,
      totalRatings: total,
    };
  }
}
