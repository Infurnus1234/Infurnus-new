import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { PostgresAdminRepository } from '../repositories/admin.repository.js';
import {
  AdminOperationsRepository,
  operationQuerySchema,
} from '../repositories/operations.repository.js';
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Admin document visibility on actual PostgreSQL',
  () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const repository = new PostgresAdminRepository(pool);
    const ids = {
      admin: randomUUID(),
      driver: randomUUID(),
      other: randomUUID(),
      customer: randomUUID(),
      profile: randomUUID(),
      otherProfile: randomUUID(),
      document: randomUUID(),
      legacy: randomUUID(),
    };
    let local = false;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(url.hostname))
        throw Error('Local disposable test database required');
      local = true;
      for (const [key, role] of [
        ['admin', 'super_admin'],
        ['driver', 'driver_fleet_owner'],
        ['other', 'driver'],
        ['customer', 'customer'],
      ] as const)
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_ONLY','Document',$2,$3)",
          [ids[key], ids[key] + '@example.invalid', role],
        );
      for (const [profile, user] of [
        [ids.profile, ids.driver],
        [ids.otherProfile, ids.other],
      ])
        await pool.query(
          'INSERT INTO driver_profiles(id,user_id,license_number,license_expiry) VALUES($1,$2,$3,CURRENT_DATE+365)',
          [profile, user, 'TEST_ONLY_' + randomUUID()],
        );
      for (const [id, code] of [
        [ids.document, 'DRIVING_LICENCE'],
        [ids.legacy, 'ADDRESS_PROOF'],
      ])
        await pool.query(
          "INSERT INTO driver_documents(id,driver_profile_id,document_type,storage_provider,storage_key,resource_type,access_mode,mime_type,file_size,uploaded_by,document_metadata) VALUES($1,$2,'other','cloudinary',$3,'image','authenticated','image/png',128,$5,$4::jsonb)",
          [
            id,
            ids.profile,
            'TEST_ONLY/' + id,
            JSON.stringify({ documentCode: code, documentNumber: 'TEST_SAMPLE_NOT_ID' }),
            ids.driver,
          ],
        );
      for (const [page, side] of [
        [1, 'FRONT'],
        [2, 'BACK'],
      ])
        await pool.query(
          "INSERT INTO driver_document_pages(document_id,version,page_number,side,storage_key,resource_type,mime_type,file_size) VALUES($1,1,$2,$3,$4,'image','image/png',128)",
          [ids.document, page, side, 'TEST_ONLY/page-' + page],
        );
    });
    afterAll(async () => {
      if (local) {
        await pool.query(
          'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[]) OR reviewer_id=$2',
          [[ids.driver, ids.other], ids.admin],
        );
        await pool.query('DELETE FROM driver_documents WHERE driver_profile_id=ANY($1::uuid[])', [
          [ids.profile, ids.otherProfile],
        ]);
        await pool.query('DELETE FROM driver_profiles WHERE id=ANY($1::uuid[])', [
          [ids.profile, ids.otherProfile],
        ]);
        await pool.query('DELETE FROM user_history WHERE user_id=ANY($1::uuid[])', [
          [ids.admin, ids.driver, ids.other, ids.customer],
        ]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
          [ids.admin, ids.driver, ids.other, ids.customer],
        ]);
      }
      await pool.end();
    });
    it('returns authoritative document type, number and separately stored sides without storage keys', async () => {
      const driver = await repository.getDriver(ids.profile);
      const documents = driver!.documents as unknown as {
        id: string;
        documentCode: string;
        documentNumber: string;
        pages: { side: string; pageNumber: number }[];
      }[];
      const doc = documents.find((row) => row.id === ids.document)!;
      expect(doc.documentCode).toBe('DRIVING_LICENCE');
      expect(doc.documentNumber).toBe('TEST_SAMPLE_NOT_ID');
      expect(doc.pages.map((row) => row.side)).toEqual(['FRONT', 'BACK']);
      expect(JSON.stringify(doc)).not.toContain('TEST_ONLY/page');
      expect(JSON.stringify(doc)).not.toContain('storageKey');
    });
    it('resolves the current page independently of queue status and the 100-request limit', async () => {
      await pool.query(
        "UPDATE provider_approval_requests SET status='CANCELLED' WHERE requester_id=$1 AND status='PENDING'",
        [ids.driver],
      );
      expect(
        (await repository.driverDocumentAccess(ids.admin, ids.profile, ids.document, 2)).storageKey,
      ).toBe('TEST_ONLY/page-2');
    });
    it('supports real legacy single-file records and the existing user-id driver alias', async () => {
      expect(
        (await repository.driverDocumentAccess(ids.admin, ids.driver, ids.legacy, 1)).storageKey,
      ).toBe('TEST_ONLY/' + ids.legacy);
    });
    it('rejects unrelated drivers and absent pages', async () => {
      await expect(
        repository.driverDocumentAccess(ids.admin, ids.otherProfile, ids.document, 1),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        repository.driverDocumentAccess(ids.admin, ids.profile, ids.document, 3),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
    it('denies non-admin and suspended administrator access at the actual document query', async () => {
      await expect(
        repository.driverDocumentAccess(ids.customer, ids.profile, ids.document),
      ).rejects.toMatchObject({ statusCode: 404 });
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [ids.admin]);
      try {
        await expect(
          repository.driverDocumentAccess(ids.admin, ids.profile, ids.document),
        ).rejects.toMatchObject({ statusCode: 404 });
      } finally {
        await pool.query("UPDATE users SET status='active' WHERE id=$1", [ids.admin]);
      }
    });
    it('filters operational details by actual record id without affecting authorization', async () => {
      const operations = new AdminOperationsRepository(pool);
      const result = await operations.list(
        'activity',
        operationQuerySchema.parse({ recordId: randomUUID(), pageSize: 1 }),
      );
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  },
);
