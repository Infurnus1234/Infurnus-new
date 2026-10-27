import type { Pool } from 'pg';
import { pool } from '../../../infrastructure/database/postgres.js';

export interface RideCustomerContactRow {
  rideId: string;
  customerId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export interface RideCustomerContactRepository {
  forAssignedDriver(rideId: string, driverUserId: string): Promise<RideCustomerContactRow | null>;
}

export class PostgresRideCustomerContactRepository implements RideCustomerContactRepository {
  constructor(private readonly database: Pick<Pool, 'query'> = pool) {}

  async forAssignedDriver(rideId: string, driverUserId: string) {
    // Scope the customer join to the current assignment in the same statement.
    // A completed/cancelled/unassigned ride never yields contact information.
    const result = await this.database.query<RideCustomerContactRow>(
      `SELECT r.id AS "rideId", c.id AS "customerId", c.first_name AS "firstName",
              c.last_name AS "lastName", c.phone
       FROM rides r
       JOIN driver_profiles d ON d.id = r.assigned_driver_id AND d.user_id = $2
       JOIN users driver_account ON driver_account.id = d.user_id
         AND driver_account.deleted_at IS NULL AND driver_account.status = 'active'
         AND driver_account.role IN ('driver', 'driver_fleet_owner')
       LEFT JOIN users c ON c.id = r.customer_id AND c.deleted_at IS NULL AND c.status = 'active'
       WHERE r.id = $1
         AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
         AND r.cancelled_at IS NULL AND r.completed_at IS NULL`,
      [rideId, driverUserId],
    );
    return result.rows[0] ?? null;
  }
}
