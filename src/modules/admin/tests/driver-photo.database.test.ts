import { requireDisposableAdministrativeDatabase } from './administrative-test-database.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { createApp } from '../../../app.js';
import { PostgresUserRepository } from '../../users/repositories/user.repository.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresAdminRepository } from '../repositories/admin.repository.js';
import { AdminManagementService } from '../services/admin-management.service.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { storageService } from '../../../infrastructure/storage/index.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'native driver photo upload and authorized Admin read on PostgreSQL',
  () => {
    const driverId = randomUUID(),
      profileId = randomUUID(),
      superId = randomUUID();
    const service = new AdminManagementService(pool);
    const files = new Map<string, Buffer>();
    // A labelled disposable PNG checks the binary lifecycle; this is not live Cloudinary verification.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=',
      'base64',
    );
    const app = createApp(
      new PostgresUserRepository(pool),
      undefined,
      new PostgresVehicleRepository(pool),
      undefined,
      new PostgresAdminRepository(pool),
      new PostgresRideRepository(pool),
      new PostgresDriverRepository(pool),
    );
    let driverToken: string, adminToken: string, adminId: string, documentId: string;
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      for (const [id, role] of [
        [driverId, 'driver'],
        [superId, 'super_admin'],
      ])
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Media',$2,$3)",
          [id, `${id}@example.invalid`, role],
        );
      await pool.query(
        'INSERT INTO driver_profiles(id,user_id,license_number,license_expiry) VALUES($1,$2,$3,CURRENT_DATE+365)',
        [profileId, driverId, `TEST_SAMPLE_${randomUUID()}`],
      );
      const admin = await service.create(superId, {
        email: `${randomUUID()}@example.invalid`,
        password: 'Local-test-only-password!',
        firstName: 'TEST_SAMPLE',
        lastName: 'Admin',
        permissions: ['drivers.read', 'drivers.detail', 'drivers.documents'],
      });
      adminId = admin.id;
      driverToken = await signAccessToken({ sub: driverId, role: 'driver', type: 'access' });
      adminToken = await signAccessToken({ sub: adminId, role: 'admin', type: 'access' });
      vi.spyOn(storageService, 'upload').mockImplementation(async (input) => {
        const key = `TEST_LOCAL/${randomUUID()}`;
        files.set(key, Buffer.from(input.file.buffer));
        return {
          storageProvider: 'cloudinary',
          storageKey: key,
          resourceType: input.resourceType,
          accessMode: input.accessMode,
          mimeType: input.file.mimeType,
          fileSize: input.file.fileSize,
        };
      });
      vi.spyOn(storageService, 'delete').mockImplementation(async (input) => {
        files.delete(input.storageKey);
      });
      vi.spyOn(storageService, 'getAccessUrl').mockImplementation(async (input) => {
        if (!files.has(input.storageKey)) throw Error('Local sample asset unavailable');
        return `https://res.cloudinary.com/TEST_ONLY/${input.storageKey}`;
      });
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await pool.end();
    });
    it('uploads through the real multipart route and persists a private native profile photo', async () => {
      const upload = await request(app)
        .post('/rides/driver/documents/profile_photo')
        .set('Authorization', `Bearer ${driverToken}`)
        .field('uploadSource', 'FILE')
        .attach('file', png, { filename: 'TEST_SAMPLE.png', contentType: 'image/png' });
      expect(upload.status).toBe(201);
      documentId = upload.body.data.id;
      const stored = await pool.query(
        'SELECT document_type,storage_key,access_mode,file_size FROM driver_documents WHERE id=$1',
        [documentId],
      );
      expect(stored.rows[0].document_type).toBe('profile_photo');
      expect(stored.rows[0].access_mode).toBe('authenticated');
      expect(stored.rows[0].file_size).toBe(png.length);
      expect(files.get(stored.rows[0].storage_key)).toEqual(png);
    });
    it('returns the real photo metadata and enforces private document access', async () => {
      const detail = await request(app)
        .get(`/admin/drivers/${profileId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detail.status).toBe(200);
      const photo = detail.body.data.documents.find((doc: { id: string }) => doc.id === documentId);
      expect(photo.documentType).toBe('profile_photo');
      expect(JSON.stringify(photo)).not.toContain('TEST_LOCAL/');
      const path = `/admin/drivers/${profileId}/documents/${documentId}/access-url`;
      expect((await request(app).get(path)).status).toBe(401);
      expect(
        (await request(app).get(path).set('Authorization', `Bearer ${driverToken}`)).status,
      ).toBe(403);
      expect(
        (await request(app).get(path).set('Authorization', `Bearer ${adminToken}`)).status,
      ).toBe(200);
      const actor = await service.identity(adminId);
      await service.update(superId, adminId, {
        permissions: ['drivers.read', 'drivers.detail'],
        expectedUpdatedAt: actor.updatedAt,
      });
      expect(
        (await request(app).get(path).set('Authorization', `Bearer ${adminToken}`)).status,
      ).toBe(403);
      const redacted = await request(app)
        .get(`/admin/drivers/${profileId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(redacted.body.data.documents).toEqual([]);
    });
    it('replaces the existing upload without creating a duplicate profile-photo identity', async () => {
      const upload = await request(app)
        .post('/rides/driver/documents/profile_photo')
        .set('Authorization', `Bearer ${driverToken}`)
        .attach('file', png, { filename: 'TEST_SAMPLE_REUPLOAD.png', contentType: 'image/png' });
      expect(upload.status).toBe(201);
      expect(upload.body.data.id).toBe(documentId);
      expect(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS total FROM driver_documents WHERE driver_profile_id=$1 AND document_type='profile_photo'",
            [profileId],
          )
        ).rows[0].total,
      ).toBe(1);
    });
  },
);
