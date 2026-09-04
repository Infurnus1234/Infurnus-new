import type { Pool } from 'pg';
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
  findAll(filters: {
    approvalStatus?: PartnerApprovalStatus | undefined;
    availabilityStatus?: PartnerAvailabilityStatus | undefined;
  }): Promise<Partner[]>;
  update(id: string, data: UpdatePartnerData): Promise<Partner | null>;
}

const partnerProjection = `
  id, user_id AS "userId", business_name AS "businessName",
  business_description AS "businessDescription", approval_status AS "approvalStatus",
  availability_status AS "availabilityStatus", created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export class PostgresPartnerRepository implements PartnerRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreatePartnerData): Promise<Partner> {
    const result = await this.pool.query<Partner>(
      `INSERT INTO partners (user_id, business_name, business_description)
       VALUES ($1, $2, $3)
       RETURNING ${partnerProjection}`,
      [data.userId, data.businessName, data.businessDescription ?? null],
    );
    const partner = result.rows.at(0);
    if (!partner) throw new Error('Partner insert returned no row');
    return partner;
  }

  async findById(id: string): Promise<Partner | null> {
    const result = await this.pool.query<Partner>(
      `SELECT ${partnerProjection} FROM partners WHERE id = $1`,
      [id],
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
      `SELECT ${partnerProjection} FROM partners${where} ORDER BY created_at DESC`,
      values,
    );
    return result.rows;
  }

  async update(id: string, data: UpdatePartnerData): Promise<Partner | null> {
    const columns: Record<string, string> = {
      businessName: 'business_name',
      businessDescription: 'business_description',
      availabilityStatus: 'availability_status',
    };
    const fields = Object.keys(data);
    const values = Object.values(data).map((value) => (value === undefined ? null : value));
    const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);
    const result = await this.pool.query<Partner>(
      `UPDATE partners SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING ${partnerProjection}`,
      [...values, id],
    );
    return result.rows[0] ?? null;
  }
}
