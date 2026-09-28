import type { Pool, PoolClient } from 'pg';
import type {
  CreatePartnerData,
  Partner,
  PartnerApprovalStatus,
  PartnerAvailabilityStatus,
  UpdatePartnerData,
} from '../types/partner.js';

export interface PartnerRepository {
  create(data: CreatePartnerData): Promise<Partner>;
  findById(id: string): Promise<Partner | null>;
  findByUserId(userId: string): Promise<Partner | null>;
  findAll(filters: {
    approvalStatus?: PartnerApprovalStatus | undefined;
    availabilityStatus?: PartnerAvailabilityStatus | undefined;
  }): Promise<Partner[]>;
  update(id: string, data: UpdatePartnerData): Promise<Partner | null>;
  review(
    id: string,
    status: 'under_review' | 'approved' | 'rejected',
    reviewerId: string,
    reason?: string | undefined,
  ): Promise<Partner | null>;
}

const partnerProjection = `
  id,
  user_id AS "userId",
  business_name AS "businessName",
  business_description AS "businessDescription",
  owner_name AS "ownerName",
  provider_type AS "providerType",
  address,
  city,
  state,
  pin_code AS "pinCode",
  number_of_vehicles AS "numberOfVehicles",
  approval_status AS "approvalStatus",
  availability_status AS "availabilityStatus",
  reviewed_at AS "reviewedAt",
  reviewed_by AS "reviewedBy",
  approved_at AS "approvedAt",
  approved_by AS "approvedBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export class PostgresPartnerRepository implements PartnerRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreatePartnerData): Promise<Partner> {
    const result = await this.pool.query<Partner>(
      `INSERT INTO partners (
         user_id,
         business_name,
         business_description,
         owner_name,
         provider_type,
         address,
         city,
         state,
         pin_code,
         number_of_vehicles
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10
       )
       RETURNING ${partnerProjection}`,
      [
        data.userId,
        data.businessName,
        data.businessDescription ?? null,
        data.ownerName ?? null,
        data.providerType ?? null,
        data.address ?? null,
        data.city ?? null,
        data.state ?? null,
        data.pinCode ?? null,
        data.numberOfVehicles ?? null,
      ],
    );

    const partner = result.rows.at(0);

    if (!partner) {
      throw new Error('Partner insert returned no row');
    }

    return partner;
  }

  async findById(id: string): Promise<Partner | null> {
    const result = await this.pool.query<Partner>(
      `SELECT ${partnerProjection}
       FROM partners
       WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async findByUserId(userId: string): Promise<Partner | null> {
    const result = await this.pool.query<Partner>(
      `SELECT ${partnerProjection}
       FROM partners
       WHERE user_id = $1`,
      [userId],
    );

    return result.rows[0] ?? null;
  }

  async findAll(filters: {
    approvalStatus?: PartnerApprovalStatus | undefined;
    availabilityStatus?: PartnerAvailabilityStatus | undefined;
  }): Promise<Partner[]> {
    const conditions: string[] = [];
    const values: string[] = [];

    if (filters.approvalStatus) {
      values.push(filters.approvalStatus);
      conditions.push(`approval_status = $${values.length}`);
    }

    if (filters.availabilityStatus) {
      values.push(filters.availabilityStatus);
      conditions.push(`availability_status = $${values.length}`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.pool.query<Partner>(
      `SELECT ${partnerProjection}
       FROM partners${where}
       ORDER BY created_at DESC`,
      values,
    );

    return result.rows;
  }

  async update(id: string, data: UpdatePartnerData): Promise<Partner | null> {
    const columns: Record<string, string> = {
      businessName: 'business_name',
      businessDescription: 'business_description',
      ownerName: 'owner_name',
      providerType: 'provider_type',
      address: 'address',
      city: 'city',
      state: 'state',
      pinCode: 'pin_code',
      numberOfVehicles: 'number_of_vehicles',
      availabilityStatus: 'availability_status',
    };

    const fields = Object.keys(data);

    const values = Object.values(data).map((value) => (value === undefined ? null : value));

    const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);

    const result = await this.pool.query<Partner>(
      `UPDATE partners
       SET ${assignments.join(', ')},
           updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${partnerProjection}`,
      [...values, id],
    );

    return result.rows[0] ?? null;
  }

  async review(
    id: string,
    status: 'under_review' | 'approved' | 'rejected',
    reviewerId: string,
    reason?: string | undefined,
  ): Promise<Partner | null> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const currentResult = await client.query<{
        approvalStatus: PartnerApprovalStatus;
      }>(
        `SELECT approval_status AS "approvalStatus"
         FROM partners
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );

      const currentPartner = currentResult.rows[0];

      if (!currentPartner) {
        await client.query('ROLLBACK');
        return null;
      }

      const previousStatus = currentPartner.approvalStatus;

      const updateResult = await client.query<Partner>(
        `UPDATE partners
         SET approval_status = $1,
             reviewed_at = NOW(),
             reviewed_by = $2,
             approved_at = CASE
               WHEN $1 = 'approved' THEN NOW()
               ELSE approved_at
             END,
             approved_by = CASE
               WHEN $1 = 'approved' THEN $2
               ELSE approved_by
             END,
             rejection_reason = CASE
               WHEN $1 = 'rejected' THEN $3
               ELSE rejection_reason
             END,
             availability_status = CASE
               WHEN $1 <> 'approved' THEN 'offline'
               ELSE availability_status
             END,
             updated_at = NOW()
         WHERE id = $4
         RETURNING ${partnerProjection}`,
        [status, reviewerId, reason ?? null, id],
      );

      const partner = updateResult.rows[0];

      if (!partner) {
        throw new Error('Partner review update returned no row');
      }

      await client.query(
        `INSERT INTO partner_approval_history (
           partner_id,
           previous_status,
           new_status,
           acted_by,
           reason
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [id, previousStatus, status, reviewerId, reason ?? null],
      );

      await client.query('COMMIT');

      return partner;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original database error.
  }
}
