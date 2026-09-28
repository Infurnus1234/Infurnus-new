import type { Pool } from 'pg';

export type DriverDocumentType = 'profile_photo' | 'driver_license' | 'vehicle_rc';

export type DriverDocumentVerificationStatus = 'pending' | 'approved' | 'rejected';

export interface DriverDocument {
  id: string;
  driverProfileId: string;
  documentType: DriverDocumentType;
  storageProvider: string;
  storageKey: string;
  resourceType: 'image' | 'raw' | 'auto';
  accessMode: 'public' | 'authenticated';
  mimeType: string;
  fileSize: number;
  verificationStatus: DriverDocumentVerificationStatus;
  rejectionReason: string | null;
  uploadedBy: string;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDriverDocumentInput {
  driverProfileId: string;
  documentType: DriverDocumentType;
  storageProvider: string;
  storageKey: string;
  resourceType: 'image' | 'raw' | 'auto';
  accessMode: 'public' | 'authenticated';
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
}

export interface ReplaceDriverDocumentInput {
  storageProvider: string;
  storageKey: string;
  resourceType: 'image' | 'raw' | 'auto';
  accessMode: 'public' | 'authenticated';
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
}

export interface UpdateDriverDocumentVerificationInput {
  status: DriverDocumentVerificationStatus;
  verifiedBy?: string | null;
  rejectionReason?: string | null;
}

export interface DriverDocumentRepository {
  create(input: CreateDriverDocumentInput): Promise<DriverDocument>;

  findById(documentId: string): Promise<DriverDocument | null>;

  findByDriverAndType(
    driverProfileId: string,
    documentType: DriverDocumentType,
  ): Promise<DriverDocument | null>;

  listByDriver(driverProfileId: string): Promise<DriverDocument[]>;

  replace(documentId: string, input: ReplaceDriverDocumentInput): Promise<DriverDocument | null>;

  updateVerification(
    documentId: string,
    input: UpdateDriverDocumentVerificationInput,
  ): Promise<DriverDocument | null>;

  delete(documentId: string): Promise<boolean>;
}

const driverDocumentProjection = `
  id,
  driver_profile_id AS "driverProfileId",
  document_type AS "documentType",
  storage_provider AS "storageProvider",
  storage_key AS "storageKey",
  resource_type AS "resourceType",
  access_mode AS "accessMode",
  mime_type AS "mimeType",
  file_size AS "fileSize",
  verification_status AS "verificationStatus",
  rejection_reason AS "rejectionReason",
  uploaded_by AS "uploadedBy",
  verified_by AS "verifiedBy",
  verified_at AS "verifiedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export class PostgresDriverDocumentRepository implements DriverDocumentRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateDriverDocumentInput): Promise<DriverDocument> {
    const result = await this.pool.query<DriverDocument>(
      `INSERT INTO driver_documents (
         driver_profile_id,
         document_type,
         storage_provider,
         storage_key,
         resource_type,
         access_mode,
         mime_type,
         file_size,
         uploaded_by
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
         $9
       )
       RETURNING ${driverDocumentProjection}`,
      [
        input.driverProfileId,
        input.documentType,
        input.storageProvider,
        input.storageKey,
        input.resourceType,
        input.accessMode,
        input.mimeType,
        input.fileSize,
        input.uploadedBy,
      ],
    );

    const document = result.rows[0];

    if (!document) {
      throw new Error('Driver document creation returned no row');
    }

    return document;
  }

  async findById(documentId: string): Promise<DriverDocument | null> {
    const result = await this.pool.query<DriverDocument>(
      `SELECT ${driverDocumentProjection}
       FROM driver_documents
       WHERE id = $1`,
      [documentId],
    );

    return result.rows[0] ?? null;
  }

  async findByDriverAndType(
    driverProfileId: string,
    documentType: DriverDocumentType,
  ): Promise<DriverDocument | null> {
    const result = await this.pool.query<DriverDocument>(
      `SELECT ${driverDocumentProjection}
       FROM driver_documents
       WHERE driver_profile_id = $1
         AND document_type = $2`,
      [driverProfileId, documentType],
    );

    return result.rows[0] ?? null;
  }

  async listByDriver(driverProfileId: string): Promise<DriverDocument[]> {
    const result = await this.pool.query<DriverDocument>(
      `SELECT ${driverDocumentProjection}
       FROM driver_documents
       WHERE driver_profile_id = $1
       ORDER BY created_at DESC`,
      [driverProfileId],
    );

    return result.rows;
  }

  async replace(
    documentId: string,
    input: ReplaceDriverDocumentInput,
  ): Promise<DriverDocument | null> {
    const result = await this.pool.query<DriverDocument>(
      `UPDATE driver_documents
       SET storage_provider = $2,
           storage_key = $3,
           resource_type = $4,
           access_mode = $5,
           mime_type = $6,
           file_size = $7,
           verification_status = 'pending',
           rejection_reason = NULL,
           uploaded_by = $8,
           verified_by = NULL,
           verified_at = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${driverDocumentProjection}`,
      [
        documentId,
        input.storageProvider,
        input.storageKey,
        input.resourceType,
        input.accessMode,
        input.mimeType,
        input.fileSize,
        input.uploadedBy,
      ],
    );

    return result.rows[0] ?? null;
  }

  async updateVerification(
    documentId: string,
    input: UpdateDriverDocumentVerificationInput,
  ): Promise<DriverDocument | null> {
    const result = await this.pool.query<DriverDocument>(
      `UPDATE driver_documents
       SET verification_status = $2,
           verified_by = $3,
           verified_at = CASE
             WHEN $2 = 'approved' THEN NOW()
             ELSE NULL
           END,
           rejection_reason = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${driverDocumentProjection}`,
      [documentId, input.status, input.verifiedBy ?? null, input.rejectionReason ?? null],
    );

    return result.rows[0] ?? null;
  }

  async delete(documentId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM driver_documents
       WHERE id = $1
       RETURNING id`,
      [documentId],
    );

    return result.rowCount === 1;
  }
}
