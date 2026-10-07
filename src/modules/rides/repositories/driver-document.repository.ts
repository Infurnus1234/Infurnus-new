import type { Pool } from 'pg';

export type DriverDocumentType =
  'profile_photo' | 'driver_license' | 'vehicle_rc' | 'identity' | 'pan' | 'other';

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
  uploadSource?: 'CAMERA' | 'GALLERY' | 'FILE';
  documentMetadata?: Record<string, unknown>;
  version?: number;
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
  uploadSource?: 'CAMERA' | 'GALLERY' | 'FILE' | undefined;
  documentMetadata?: Record<string, unknown> | undefined;
}

export interface ReplaceDriverDocumentInput {
  storageProvider: string;
  storageKey: string;
  resourceType: 'image' | 'raw' | 'auto';
  accessMode: 'public' | 'authenticated';
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  uploadSource?: 'CAMERA' | 'GALLERY' | 'FILE' | undefined;
  documentMetadata?: Record<string, unknown> | undefined;
}

export interface UpdateDriverDocumentVerificationInput {
  status: DriverDocumentVerificationStatus;
  verifiedBy?: string | null;
  rejectionReason?: string | null;
}

export interface DriverDocumentRepository {
  currentPages?(driverProfileId: string, documentId: string): Promise<DriverDocumentPage[]>;
  saveBundle?(
    input: CreateDriverDocumentInput,
    pages: DriverDocumentPage[],
  ): Promise<{ document: DriverDocument; previous: DriverDocument | null }>;
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

export interface DriverDocumentPage {
  storageKey: string;
  resourceType: 'image' | 'raw' | 'auto';
  mimeType: string;
  fileSize: number;
  side: 'FRONT' | 'BACK' | 'PAGE';
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
  ,upload_source AS "uploadSource",document_metadata AS "documentMetadata",version
`;

export class PostgresDriverDocumentRepository implements DriverDocumentRepository {
  constructor(private readonly pool: Pool) {}
  async currentPages(driverProfileId: string, documentId: string) {
    return (
      await this.pool.query<DriverDocumentPage>(
        `SELECT p.storage_key AS "storageKey",p.resource_type AS "resourceType",p.mime_type AS "mimeType",p.file_size AS "fileSize",p.side
       FROM driver_document_pages p JOIN driver_documents d ON d.id=p.document_id AND d.version=p.version
       WHERE d.id=$1 AND d.driver_profile_id=$2 ORDER BY p.page_number LIMIT 5`,
        [documentId, driverProfileId],
      )
    ).rows;
  }

  async saveBundle(input: CreateDriverDocumentInput, pages: DriverDocumentPage[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query(
        `SELECT dp.id FROM driver_profiles dp JOIN users u ON u.id=dp.user_id
         WHERE dp.id=$1 AND dp.user_id=$2 AND u.status='active' AND u.deleted_at IS NULL
         AND u.role IN ('driver','driver_fleet_owner') FOR UPDATE OF dp`,
        [input.driverProfileId, input.uploadedBy],
      );
      if (!owner.rowCount) throw new Error('Driver document upload is not authorized');
      const previousResult = await client.query<DriverDocument>(
        `SELECT ${driverDocumentProjection} FROM driver_documents WHERE driver_profile_id=$1 AND document_type=$2 AND COALESCE(document_metadata->>'documentCode','')=$3 FOR UPDATE`,
        [input.driverProfileId, input.documentType, input.documentMetadata?.documentCode ?? ''],
      );
      const previous = previousResult.rows[0] ?? null;
      const values = [
        input.driverProfileId,
        input.documentType,
        input.storageProvider,
        input.storageKey,
        input.resourceType,
        input.accessMode,
        input.mimeType,
        input.fileSize,
        input.uploadedBy,
        input.uploadSource ?? 'FILE',
        input.documentMetadata ?? {},
      ];
      const result = previous
        ? await client.query<DriverDocument>(
            `UPDATE driver_documents SET storage_provider=$3,storage_key=$4,resource_type=$5,access_mode=$6,mime_type=$7,file_size=$8,
           uploaded_by=$9,upload_source=$10,document_metadata=$11,verification_status='pending',verified_at=NULL,verified_by=NULL,rejection_reason=NULL,updated_at=NOW()
           WHERE driver_profile_id=$1 AND document_type=$2 AND COALESCE(document_metadata->>'documentCode','')=COALESCE($11::jsonb->>'documentCode','') RETURNING ${driverDocumentProjection}`,
            values,
          )
        : await client.query<DriverDocument>(
            `INSERT INTO driver_documents(driver_profile_id,document_type,storage_provider,storage_key,resource_type,access_mode,mime_type,file_size,uploaded_by,upload_source,document_metadata)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${driverDocumentProjection}`,
            values,
          );
      const document = result.rows[0]!;
      for (const [index, page] of pages.entries())
        await client.query(
          `INSERT INTO driver_document_pages(document_id,version,page_number,side,storage_key,resource_type,mime_type,file_size)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            document.id,
            document.version,
            index + 1,
            page.side,
            page.storageKey,
            page.resourceType,
            page.mimeType,
            page.fileSize,
          ],
        );
      await client.query(
        `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
         VALUES($1,$2,'driver_document',$3,$4)`,
        [
          input.uploadedBy,
          previous ? 'driver_document_replaced' : 'driver_document_uploaded',
          document.id,
          {
            version: document.version,
            type: input.documentType,
            source: input.uploadSource ?? 'FILE',
            pageCount: pages.length,
          },
        ],
      );
      await client.query('COMMIT');
      return { document, previous };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

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
         uploaded_by,upload_source,document_metadata
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
         $9,$10,$11
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
        input.uploadSource ?? 'FILE',
        input.documentMetadata ?? {},
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
           upload_source = $9,
           document_metadata = $10,
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
        input.uploadSource ?? 'FILE',
        input.documentMetadata ?? {},
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
       SET verification_status = $2::driver_document_verification_status,
           verified_by = $3,
           verified_at = CASE
             WHEN $2::driver_document_verification_status = 'approved' THEN NOW()
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
