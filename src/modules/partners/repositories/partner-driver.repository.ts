import type { Pool } from 'pg';
import type {
  CreatePartnerDriverData,
  PartnerDriver,
  PartnerDriverStatus,
} from '../types/partner-driver.js';

export interface PartnerDriverRepository {
  create(data: CreatePartnerDriverData): Promise<PartnerDriver>;

  findById(id: string): Promise<PartnerDriver | null>;

  findByPartnerAndDriver(partnerId: string, driverProfileId: string): Promise<PartnerDriver | null>;

  listByPartner(partnerId: string, status?: PartnerDriverStatus): Promise<PartnerDriver[]>;

  listByDriver(driverProfileId: string, status?: PartnerDriverStatus): Promise<PartnerDriver[]>;

  updateStatus(id: string, status: PartnerDriverStatus): Promise<PartnerDriver | null>;
}

const partnerDriverProjection = `
  id,
  partner_id AS "partnerId",
  driver_profile_id AS "driverProfileId",
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export class PostgresPartnerDriverRepository implements PartnerDriverRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreatePartnerDriverData): Promise<PartnerDriver> {
    const result = await this.pool.query<PartnerDriver>(
      `INSERT INTO partner_drivers (
         partner_id,
         driver_profile_id
       )
       VALUES ($1, $2)
       RETURNING ${partnerDriverProjection}`,
      [data.partnerId, data.driverProfileId],
    );

    const relationship = result.rows.at(0);

    if (!relationship) {
      throw new Error('Partner-driver relationship insert returned no row');
    }

    return relationship;
  }

  async findById(id: string): Promise<PartnerDriver | null> {
    const result = await this.pool.query<PartnerDriver>(
      `SELECT ${partnerDriverProjection}
       FROM partner_drivers
       WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async findByPartnerAndDriver(
    partnerId: string,
    driverProfileId: string,
  ): Promise<PartnerDriver | null> {
    const result = await this.pool.query<PartnerDriver>(
      `SELECT ${partnerDriverProjection}
       FROM partner_drivers
       WHERE partner_id = $1
         AND driver_profile_id = $2`,
      [partnerId, driverProfileId],
    );

    return result.rows[0] ?? null;
  }

  async listByPartner(partnerId: string, status?: PartnerDriverStatus): Promise<PartnerDriver[]> {
    const values: string[] = [partnerId];

    let statusCondition = '';

    if (status) {
      values.push(status);
      statusCondition = ` AND status = $${values.length}`;
    }

    const result = await this.pool.query<PartnerDriver>(
      `SELECT ${partnerDriverProjection}
       FROM partner_drivers
       WHERE partner_id = $1
       ${statusCondition}
       ORDER BY created_at DESC`,
      values,
    );

    return result.rows;
  }

  async listByDriver(
    driverProfileId: string,
    status?: PartnerDriverStatus,
  ): Promise<PartnerDriver[]> {
    const values: string[] = [driverProfileId];

    let statusCondition = '';

    if (status) {
      values.push(status);
      statusCondition = ` AND status = $${values.length}`;
    }

    const result = await this.pool.query<PartnerDriver>(
      `SELECT ${partnerDriverProjection}
       FROM partner_drivers
       WHERE driver_profile_id = $1
       ${statusCondition}
       ORDER BY created_at DESC`,
      values,
    );

    return result.rows;
  }

  async updateStatus(id: string, status: PartnerDriverStatus): Promise<PartnerDriver | null> {
    const result = await this.pool.query<PartnerDriver>(
      `UPDATE partner_drivers
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING ${partnerDriverProjection}`,
      [status, id],
    );

    return result.rows[0] ?? null;
  }
}
