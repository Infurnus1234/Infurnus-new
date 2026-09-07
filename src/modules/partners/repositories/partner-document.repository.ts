import type { Pool } from 'pg';
import type {
  CreatePartnerDocumentData,
  PartnerDocument,
  UpdatePartnerDocumentData,
} from '../types/partner-document.js';

export interface PartnerDocumentRepository {
  partnerExists(id: string): Promise<boolean>;
  partnerOwnerId(id: string): Promise<string | null>;
  vehicleBelongsToPartner(vehicleId: string, partnerId: string): Promise<boolean>;
  create(data: CreatePartnerDocumentData): Promise<PartnerDocument>;
  findByPartner(partnerId: string): Promise<PartnerDocument[]>;
  findById(id: string, partnerId: string): Promise<PartnerDocument | null>;
  update(
    id: string,
    partnerId: string,
    data: UpdatePartnerDocumentData,
  ): Promise<PartnerDocument | null>;
}

const projection = `
  id, partner_id AS "partnerId", vehicle_id AS "vehicleId", document_type AS "documentType",
  status, issued_at AS "issuedAt", expires_at AS "expiresAt",
  uploaded_at AS "uploadedAt", verified_at AS "verifiedAt", created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export class PostgresPartnerDocumentRepository implements PartnerDocumentRepository {
  constructor(private readonly pool: Pool) {}

  async partnerExists(id: string): Promise<boolean> {
    const result = await this.pool.query('SELECT id FROM partners WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  async partnerOwnerId(id: string): Promise<string | null> {
    const result = await this.pool.query<{ userId: string }>(
      'SELECT user_id AS "userId" FROM partners WHERE id = $1',
      [id],
    );
    return result.rows[0]?.userId ?? null;
  }

  async vehicleBelongsToPartner(vehicleId: string, partnerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT v.id
       FROM vehicles v
       JOIN driver_profiles d ON d.id = v.driver_profile_id
       JOIN partners p ON p.user_id = d.user_id
       WHERE v.id = $1 AND p.id = $2`,
      [vehicleId, partnerId],
    );
    return result.rowCount === 1;
  }

  async create(data: CreatePartnerDocumentData): Promise<PartnerDocument> {
    const result = await this.pool.query<PartnerDocument>(
      `INSERT INTO partner_documents
        (partner_id, vehicle_id, document_type, status, metadata,
          issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${projection}`,
      [
        data.partnerId,
        data.vehicleId ?? null,
        data.documentType,
        data.status ?? 'PENDING',
        data.metadata ?? null,
        data.issuedAt ?? null,
        data.expiresAt ?? null,
      ],
    );
    const document = result.rows.at(0);
    if (!document) throw new Error('Document insert returned no row');
    return document;
  }

  async findByPartner(partnerId: string): Promise<PartnerDocument[]> {
    const result = await this.pool.query<PartnerDocument>(
      `SELECT ${projection} FROM partner_documents
       WHERE partner_id = $1 ORDER BY created_at DESC`,
      [partnerId],
    );
    return result.rows;
  }

  async findById(id: string, partnerId: string): Promise<PartnerDocument | null> {
    const result = await this.pool.query<PartnerDocument>(
      `SELECT ${projection} FROM partner_documents
       WHERE id = $1 AND partner_id = $2`,
      [id, partnerId],
    );
    return result.rows[0] ?? null;
  }

  async update(
    id: string,
    partnerId: string,
    data: UpdatePartnerDocumentData,
  ): Promise<PartnerDocument | null> {
    const columns: Record<string, string> = {
      status: 'status',
      metadata: 'metadata',
      issuedAt: 'issued_at',
      expiresAt: 'expires_at',
      verifiedAt: 'verified_at',
    };
    const fields = Object.keys(data);
    const values = Object.values(data);
    const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);
    const result = await this.pool.query<PartnerDocument>(
      `UPDATE partner_documents SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length + 1} AND partner_id = $${values.length + 2}
       RETURNING ${projection}`,
      [...values, id, partnerId],
    );
    return result.rows[0] ?? null;
  }
}
