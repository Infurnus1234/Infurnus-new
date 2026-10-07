import { PostgresPartnerDocumentRepository } from '../../partners/repositories/partner-document.repository.js';
import { PartnerDocumentService } from '../../partners/services/partner-document.service.js';
import { randomUUID } from 'node:crypto';
import { PostgresDriverApplicationRepository } from '../../driver-applications/driver-application.repository.js';
import { createServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import {
  createProviderOperationsRouter,
  createProviderApprovalRouter,
} from '../routes/provider-operations.routes.js';
import { attachProviderTracking } from '../services/provider-tracking.socket.js';
import {
  driverDocumentMetadataSchema,
  driverLocationSchema,
} from '../../rides/schemas/driver.schemas.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Provider operations ownership and PostGIS',
  () => {
    const repository = new PostgresProviderOperationsRepository(pool);
    const drivers = new PostgresDriverRepository(pool);
    const documents = new PostgresDriverDocumentRepository(pool);
    let owners: string[],
      users: string[],
      profiles: string[],
      fleets: string[],
      vehicles: string[],
      admin: string;
    let app: express.Express;
    beforeEach(async () => {
      owners = [];
      users = [];
      profiles = [];
      fleets = [];
      vehicles = [];
      for (const role of ['admin', 'fleet_owner', 'fleet_owner', 'driver', 'driver']) {
        const result = await pool.query(
          "INSERT INTO users(first_name,last_name,phone,role) VALUES('Operations','Test',$1,$2) RETURNING id",
          ['+94' + randomUUID().replaceAll('-', '').slice(0, 10), role],
        );
        if (role === 'admin') admin = result.rows[0].id;
        else if (role === 'fleet_owner') owners.push(result.rows[0].id);
        else users.push(result.rows[0].id);
      }
      for (let i = 0; i < 2; i++) {
        const partner = await pool.query(
          "INSERT INTO partners(user_id,business_name) VALUES($1,'Fleet Test') RETURNING id",
          [owners[i]],
        );
        fleets.push(partner.rows[0].id);
        await pool.query(
          "UPDATE partners SET approval_status='under_review',reviewed_by=$2,reviewed_at=NOW() WHERE id=$1",
          [partner.rows[0].id, admin],
        );
        await pool.query(
          "UPDATE partners SET approval_status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1",
          [partner.rows[0].id, admin],
        );
        const profile = await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,availability_status) VALUES($1,$2,CURRENT_DATE+365,'approved','available') RETURNING id",
          [users[i], randomUUID()],
        );
        profiles.push(profile.rows[0].id);
        await pool.query(
          'INSERT INTO partner_drivers(partner_id,driver_profile_id) VALUES($1,$2)',
          [fleets[i], profiles[i]],
        );
        const vehicle = await pool.query(
          "INSERT INTO vehicles(owner_id,driver_profile_id,make,model,plate_number,verification_status,is_active) VALUES($1,$2,'Test','Car',$3,'approved',TRUE) RETURNING id",
          [owners[i], profiles[i], randomUUID().slice(0, 18)],
        );
        vehicles.push(vehicle.rows[0].id);
      }
      app = express();
      app.use(express.json());
      app.use('/provider', createProviderOperationsRouter(repository));
      app.use('/provider-approvals', createProviderApprovalRouter(repository));
      app.use(errorMiddleware);
    });
    afterEach(async () => {
      await pool.query('DELETE FROM driver_applications WHERE driver_profile_id=ANY($1::uuid[])', [
        profiles,
      ]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [[...owners, ...users]],
      );
      await pool.query('DELETE FROM vehicles WHERE id=ANY($1::uuid[])', [vehicles]);
      await pool.query('DELETE FROM partner_drivers WHERE partner_id=ANY($1::uuid[])', [fleets]);
      await pool.query('DELETE FROM partners WHERE id=ANY($1::uuid[])', [fleets]);
      await pool.query('DELETE FROM driver_profiles WHERE id=ANY($1::uuid[])', [profiles]);
      await pool.query('DELETE FROM provider_document_requirements WHERE updated_by=$1', [admin]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
        [...owners, ...users, admin],
      ]);
    });
    it('fleet tracking never returns another fleet and driver-only claims are denied', async () => {
      await drivers.updateLocation(profiles[0]!, {
        latitude: 25.6,
        longitude: 85.1,
        recordedAt: new Date(Date.now() - 1000),
        speed: 10,
        heading: 90,
        accuracy: 5,
      });
      const rows = await repository.tracking(owners[0]!, 'fleet_owner');
      expect(rows).toHaveLength(1);
      expect(rows[0].driverProfileId).toBe(profiles[0]);
      expect(rows[0].vehicleId).toBe(vehicles[0]);
      expect(rows[0]).toMatchObject({
        latitude: 25.6,
        longitude: 85.1,
        speed: 10,
        heading: 90,
        accuracy: 5,
        online: true,
      });
      await expect(repository.tracking(users[0]!, 'driver')).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(repository.tracking(users[0]!, 'fleet_owner')).rejects.toMatchObject({
        statusCode: 403,
      });
    });
    it('location history is monotonic, private and revoked after membership removal', async () => {
      const timestamp = new Date(Date.now() - 1000);
      expect(
        await drivers.updateLocation(profiles[0]!, {
          latitude: 25,
          longitude: 85,
          recordedAt: timestamp,
        }),
      ).toBe(true);
      expect(
        await drivers.updateLocation(profiles[0]!, {
          latitude: 26,
          longitude: 86,
          recordedAt: timestamp,
        }),
      ).toBe(false);
      expect(
        await repository.locationHistory(owners[0]!, 'fleet_owner', profiles[0]!),
      ).toHaveLength(1);
      expect(await repository.locationHistory(owners[1]!, 'fleet_owner', profiles[0]!)).toEqual([]);
      expect(await repository.locationHistory(users[1]!, 'driver', profiles[0]!)).toEqual([]);
      await pool.query("UPDATE partner_drivers SET status='INACTIVE' WHERE partner_id=$1", [
        fleets[0],
      ]);
      expect(await repository.locationHistory(owners[0]!, 'fleet_owner', profiles[0]!)).toEqual([]);
      expect(await repository.locationHistory(users[0]!, 'driver', profiles[0]!)).toHaveLength(1);
    });
    it('onboarding queues are unique under repeated concurrent submissions', async () => {
      await Promise.all(
        Array.from({ length: 8 }, () =>
          pool.query("UPDATE partners SET business_name='Resubmitted' WHERE id=$1", [fleets[0]]),
        ),
      );
      const rows = await repository.approvals(owners[0]!, 'fleet_owner');
      expect(
        rows.filter((row) => row.target_id === fleets[0] && row.status === 'PENDING'),
      ).toHaveLength(1);
      await expect(
        repository.approval(owners[1]!, 'fleet_owner', rows[0].id),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        pool.query(
          "UPDATE provider_approval_requests SET status='APPROVED',reviewer_id=requester_id,reviewer_role='admin',reviewed_at=NOW() WHERE id=$1",
          [rows[0].id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('document replacement resets review and retains previous version atomically', async () => {
      const input = {
        driverProfileId: profiles[0]!,
        documentType: 'driver_license' as const,
        storageProvider: 'cloudinary',
        storageKey: 'private/' + randomUUID(),
        resourceType: 'image' as const,
        accessMode: 'authenticated' as const,
        mimeType: 'image/jpeg',
        fileSize: 100,
        uploadedBy: users[0]!,
        uploadSource: 'CAMERA' as const,
        documentMetadata: { side: 'FRONT' },
      };
      const document = await documents.create(input);
      await documents.updateVerification(document.id, { status: 'approved', verifiedBy: admin });
      const replacement = await documents.replace(document.id, {
        ...input,
        storageKey: 'private/' + randomUUID(),
      });
      expect(replacement).toMatchObject({
        version: 2,
        uploadSource: 'CAMERA',
        verificationStatus: 'pending',
        verifiedBy: null,
      });
      const history = await pool.query(
        'SELECT version FROM driver_document_history WHERE document_id=$1',
        [document.id],
      );
      expect(history.rows).toEqual([{ version: 1 }]);
      expect(
        (await repository.approvals(users[0]!, 'driver')).filter(
          (row) => row.target_id === document.id && row.status === 'PENDING',
        ),
      ).toHaveLength(1);
    });
    it('changing an approved licence requires re-verification and prevents online status', async () => {
      await pool.query('UPDATE driver_profiles SET license_number=$2 WHERE id=$1', [
        profiles[0],
        randomUUID(),
      ]);
      expect(await drivers.findProfileById(profiles[0]!)).toMatchObject({
        verificationStatus: 'pending',
        availabilityStatus: 'unavailable',
      });
      expect(
        (await repository.approvals(users[0]!, 'driver')).some(
          (row) => row.target_id === profiles[0],
        ),
      ).toBe(true);
    });
    it('rejects forged ids, self-approval and driver mode escalation over HTTP', async () => {
      const token = await signAccessToken({ sub: users[0]!, role: 'driver', type: 'access' });
      expect(
        (
          await request(app)
            .get('/provider/tracking')
            .set('authorization', 'Bearer ' + token)
            .set('x-provider-mode', 'fleet_owner')
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch('/provider/approvals/' + randomUUID())
            .set('authorization', 'Bearer ' + token)
            .send({ status: 'APPROVED' })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .get('/provider/drivers/' + profiles[1] + '/location-history')
            .set('authorization', 'Bearer ' + token)
        ).body.data,
      ).toEqual([]);
      for (const latitude of [91, -91, Infinity])
        expect(
          driverLocationSchema.safeParse({ latitude, longitude: 85, timestamp: new Date() })
            .success,
        ).toBe(false);
      expect(
        driverDocumentMetadataSchema.safeParse({ uploadSource: 'CAMERA', expiresAt: '2000-01-01' })
          .success,
      ).toBe(false);
      expect(
        driverDocumentMetadataSchema.safeParse({ verificationStatus: 'approved' }).success,
      ).toBe(false);
    });
    it('existing Socket.IO rejects private tracking from driver and rechecks suspended owners', async () => {
      const server = createServer(app);
      const io = createSocketServer(server);
      attachProviderTracking(io, repository);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as { port: number };
      const clients = [];
      try {
        for (const [id, role] of [
          [users[0]!, 'driver'],
          [owners[0]!, 'fleet_owner'],
        ]) {
          const client = connectSocket('http://127.0.0.1:' + address.port, {
            auth: { token: await signAccessToken({ sub: id!, role: role!, type: 'access' }) },
            transports: ['websocket'],
            forceNew: true,
          });
          clients.push(client);
          await new Promise<void>((resolve, reject) => {
            client.once('connect', resolve);
            client.once('connect_error', reject);
          });
          const result = await client.timeout(2000).emitWithAck('fleet:tracking:subscribe', {});
          expect(result.success).toBe(role === 'fleet_owner');
        }
        await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [owners[0]]);
        const response = await clients[1]!
          .timeout(2000)
          .emitWithAck('fleet:tracking:subscribe', {});
        expect(response.success).toBe(false);
      } finally {
        for (const client of clients) client.disconnect();
        await new Promise<void>((resolve) => io.close(() => resolve()));
      }
    });
    it('administrator handoff rejects requester and stale-target review, then records a reason', async () => {
      await repository.requestApproval(users[0]!, 'driver', {
        targetType: 'driver_profile',
        targetId: profiles[0]!,
        requestType: 'driver_verification',
      });
      const reqs = await repository.approvals(users[0]!, 'driver');
      const row = reqs.find((x) => x.target_type === 'driver_profile')!;
      await expect(repository.pendingApprovals(users[0]!)).rejects.toMatchObject({
        statusCode: 403,
      });
      const detail = await repository.approvalDetails(admin, row.id);
      await expect(
        repository.reviewApproval(admin, row.id, {
          status: 'REJECTED',
          reason: 'Licence evidence missing',
          expectedUpdatedAt: '2000-01-01T00:00:00Z',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      await repository.reviewApproval(admin, row.id, {
        status: 'REJECTED',
        reason: 'Licence evidence missing',
        expectedUpdatedAt: detail.target.updated_at,
      });
      expect(await repository.approval(users[0]!, 'driver', row.id)).toMatchObject({
        status: 'REJECTED',
        rejection_reason: 'Licence evidence missing',
      });
      expect(await drivers.findProfileById(profiles[0]!)).toMatchObject({
        verificationStatus: 'rejected',
        verifiedBy: admin,
      });
      const token = await signAccessToken({ sub: users[0]!, role: 'driver', type: 'access' });
      expect(
        (
          await request(app)
            .get('/provider-approvals')
            .set('authorization', 'Bearer ' + token)
        ).status,
      ).toBe(403);
    });
    it('owned driver profiles and documents are isolated and revoked on membership removal', async () => {
      expect((await repository.driverProfile(owners[0]!, 'fleet_owner', profiles[0]!)).id).toBe(
        profiles[0],
      );
      await expect(
        repository.driverProfile(owners[1]!, 'fleet_owner', profiles[0]!),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        repository.driverDocuments(users[1]!, 'driver', profiles[0]!),
      ).rejects.toMatchObject({ statusCode: 404 });
      await pool.query("UPDATE partner_drivers SET status='INACTIVE' WHERE driver_profile_id=$1", [
        profiles[0],
      ]);
      await expect(
        repository.driverDocuments(owners[0]!, 'fleet_owner', profiles[0]!),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
    it('partner document renewal resets verification, preserves metadata history and rejects stale versions', async () => {
      const repo = new PostgresPartnerDocumentRepository(pool);
      const service = new PartnerDocumentService(repo);
      const actor = { userId: owners[0]!, role: 'fleet_owner' };
      const doc = await service.createDocumentMetadata(
        fleets[0]!,
        {
          documentType: 'DRIVING_LICENCE',
          expiresAt: '2099-01-01',
          metadata: {
            documentNumber: 'DL123',
            uploadSource: 'CAMERA',
            storage: {
              storageProvider: 'cloudinary',
              storageKey: 'private/old',
              resourceType: 'image',
              accessMode: 'authenticated',
              mimeType: 'image/jpeg',
              fileSize: 100,
              originalFileName: 'licence.jpg',
            },
          },
        },
        actor,
      );
      expect(doc).toMatchObject({
        version: 1,
        uploadSource: 'CAMERA',
        documentMetadata: { documentNumber: 'DL123' },
      });
      await service.updateDocumentMetadata(fleets[0]!, doc.id, { status: 'SUBMITTED' }, actor);
      await service.updateDocumentMetadata(
        fleets[0]!,
        doc.id,
        { status: 'VERIFIED' },
        { userId: admin, role: 'admin' },
      );
      const current = await repo.findById(doc.id, fleets[0]!);
      const renewed = await service.updateDocumentMetadata(
        fleets[0]!,
        doc.id,
        {
          expiresAt: '2099-02-01',
          metadata: {
            ...current!.metadata,
            storage: { ...current!.metadata!.storage!, storageKey: 'private/new' },
          },
        },
        actor,
        current!.version,
      );
      expect(renewed).toMatchObject({ version: 2, status: 'PENDING', verifiedAt: null });
      expect(
        (
          await pool.query('SELECT snapshot FROM partner_document_history WHERE document_id=$1', [
            doc.id,
          ])
        ).rows[0].snapshot.metadata.storage.storageKey,
      ).toBe('private/old');
      await expect(
        service.updateDocumentMetadata(
          fleets[0]!,
          doc.id,
          {
            metadata: {
              ...current!.metadata,
              storage: { ...current!.metadata!.storage!, storageKey: 'private/stale' },
            },
          },
          actor,
          1,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        service.updateDocumentMetadata(fleets[0]!, doc.id, { status: 'VERIFIED' }, actor),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        service.getDocument(fleets[0]!, doc.id, { userId: owners[1]!, role: 'fleet_owner' }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    it('resolves only active policies for the actual role and wildcard/category', async () => {
      const base = {
        providerRole: 'driver',
        category: 'sedan',
        documentCode: 'identity',
        required: true,
        requiresExpiry: true,
        minimumPages: 2,
        active: true,
      };
      expect(await repository.documentRequirements(users[0]!, 'driver', 'sedan')).toEqual([]);
      for (const rule of [
        base,
        { ...base, category: '*', documentCode: 'pan', required: false },
        { ...base, category: 'truck', documentCode: 'other' },
        { ...base, providerRole: 'fleet_owner', documentCode: 'licence' },
        { ...base, documentCode: 'address_proof', active: false },
      ])
        await repository.configureDocumentRequirement(admin, rule);
      const resolved = await repository.documentRequirements(users[0]!, 'driver', 'sedan');
      expect(resolved).toEqual([
        expect.objectContaining({
          document_code: 'identity',
          required: true,
          requires_expiry: true,
          minimum_pages: 2,
          vehicle_category: 'sedan',
        }),
        expect.objectContaining({ document_code: 'pan', required: false, vehicle_category: '*' }),
      ]);
      await expect(
        repository.documentRequirements(users[0]!, 'fleet_owner', 'sedan'),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    it('empty, optional and inactive policies do not invent required documents', async () => {
      const compliance = async () =>
        (
          await pool.query("SELECT provider_compliance_satisfied($1,$2,NULL,NULL,'sedan') AS ok", [
            users[0],
            profiles[0],
          ])
        ).rows[0].ok;
      expect(await compliance()).toBe(true);
      const policy = {
        providerRole: 'driver',
        category: 'sedan',
        documentCode: 'identity',
        required: false,
        requiresExpiry: true,
        minimumPages: 2,
        active: true,
      };
      await repository.configureDocumentRequirement(admin, policy);
      expect(await compliance()).toBe(true);
      await repository.configureDocumentRequirement(admin, { ...policy, required: true });
      expect(await compliance()).toBe(false);
      expect(
        (
          await pool.query("SELECT provider_compliance_satisfied($1,$2,NULL,NULL,'truck') AS ok", [
            users[0],
            profiles[0],
          ])
        ).rows[0].ok,
      ).toBe(true);
      await repository.configureDocumentRequirement(admin, {
        ...policy,
        required: true,
        active: false,
      });
      expect(await compliance()).toBe(true);
      await expect(
        repository.configureDocumentRequirement(users[0]!, policy),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    it('configured expiry requirement rejects an approved document without an expiry date', async () => {
      const doc = await documents.saveBundle(
        {
          driverProfileId: profiles[0]!,
          documentType: 'identity',
          storageProvider: 'cloudinary',
          storageKey: 'private/' + randomUUID(),
          resourceType: 'image',
          accessMode: 'authenticated',
          mimeType: 'image/jpeg',
          fileSize: 100,
          uploadedBy: users[0]!,
          uploadSource: 'FILE',
          documentMetadata: {},
        },
        [],
      );
      await documents.updateVerification(doc.document.id, {
        status: 'approved',
        verifiedBy: admin,
      });
      const policy = {
        providerRole: 'driver',
        category: '*',
        documentCode: 'identity',
        required: true,
        requiresExpiry: false,
        minimumPages: 1,
        active: true,
      };
      const compliance = async () =>
        (
          await pool.query("SELECT provider_compliance_satisfied($1,$2,NULL,NULL,'sedan') AS ok", [
            users[0],
            profiles[0],
          ])
        ).rows[0].ok;
      await repository.configureDocumentRequirement(admin, policy);
      expect(await compliance()).toBe(true);
      await repository.configureDocumentRequirement(admin, { ...policy, requiresExpiry: true });
      expect(await compliance()).toBe(false);
    });
    it('configured policy validates real driver bundles without seeding mandatory rules', async () => {
      await repository.configureDocumentRequirement(admin, {
        providerRole: 'driver',
        category: '*',
        documentCode: 'identity',
        required: true,
        requiresExpiry: true,
        minimumPages: 2,
        active: true,
      });
      const input = {
        driverProfileId: profiles[0]!,
        documentType: 'identity' as const,
        storageProvider: 'cloudinary',
        storageKey: 'private/' + randomUUID(),
        resourceType: 'image' as const,
        accessMode: 'authenticated' as const,
        mimeType: 'image/jpeg',
        fileSize: 100,
        uploadedBy: users[0]!,
        uploadSource: 'CAMERA' as const,
        documentMetadata: { expiresAt: '2099-01-01' },
      };
      await expect(documents.saveBundle(input, [])).rejects.toMatchObject({ code: '23514' });
      const doc = await documents.saveBundle(input, [
        { ...input, side: 'FRONT' as const },
        { ...input, storageKey: 'private/back', side: 'BACK' as const },
      ]);
      expect(await documents.currentPages(profiles[0]!, doc.document.id)).toHaveLength(2);
      const compliance = () =>
        pool.query(`SELECT provider_compliance_satisfied($1,$2,NULL,NULL,'*') AS ok`, [
          users[0],
          profiles[0],
        ]);
      expect((await compliance()).rows[0].ok).toBe(false);
      await documents.updateVerification(doc.document.id, {
        status: 'approved',
        verifiedBy: admin,
      });
      expect((await compliance()).rows[0].ok).toBe(true);
    });
    it('legacy fleet vehicle unassignment/deactivation cannot detach a busy driver', async () => {
      await pool.query("UPDATE driver_profiles SET availability_status='busy' WHERE id=$1", [
        profiles[0],
      ]);
      await expect(
        pool.query('UPDATE vehicles SET driver_profile_id=NULL WHERE id=$1', [vehicles[0]]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        repository.manageVehicle(owners[0]!, 'fleet_owner', vehicles[0]!, {
          operationalStatus: 'INACTIVE',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('fleet membership removal is owner-scoped and clears association/availability', async () => {
      await expect(
        repository.deactivateMembership(owners[1]!, 'fleet_owner', profiles[0]!),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        repository.deactivateMembership(users[0]!, 'driver', profiles[0]!),
      ).rejects.toMatchObject({ statusCode: 403 });
      await repository.deactivateMembership(owners[0]!, 'fleet_owner', profiles[0]!);
      expect(
        (await pool.query('SELECT driver_profile_id FROM vehicles WHERE id=$1', [vehicles[0]]))
          .rows[0].driver_profile_id,
      ).toBeNull();
      expect(await drivers.findProfileById(profiles[0]!)).toMatchObject({
        availabilityStatus: 'unavailable',
        activeVehicleId: null,
      });
      expect(await repository.tracking(owners[0]!, 'fleet_owner')).toEqual([]);
    });
    it('dual-role mode cannot escalate fleet operations from driver context', async () => {
      await pool.query("UPDATE users SET role='driver_fleet_owner' WHERE id=$1", [owners[0]]);
      const token = await signAccessToken({
        sub: owners[0]!,
        role: 'driver_fleet_owner',
        type: 'access',
      });
      expect(
        (
          await request(app)
            .get('/provider/tracking')
            .set('authorization', 'Bearer ' + token)
            .set('x-provider-mode', 'driver')
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/provider/tracking')
            .set('authorization', 'Bearer ' + token)
            .set('x-provider-mode', 'fleet_owner')
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .post('/provider/approval-requests')
            .set('authorization', 'Bearer ' + token)
            .set('x-provider-mode', 'driver')
            .send({
              targetType: 'driver_profile',
              targetId: profiles[1],
              requestType: 'driver_association',
            })
        ).status,
      ).toBe(403);
    });
    it('requester cannot self-review after changing to an administrator role', async () => {
      const req = await repository.requestApproval(owners[0]!, 'fleet_owner', {
        targetType: 'partner',
        targetId: fleets[0]!,
        requestType: 'fleet_verification',
      });
      await pool.query("UPDATE users SET role='admin' WHERE id=$1", [owners[0]]);
      const detail = await repository.approvalDetails(owners[0]!, req.id);
      await expect(
        repository.reviewApproval(owners[0]!, req.id, {
          status: 'APPROVED',
          expectedUpdatedAt: detail.target.updated_at,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    it('concurrent review applies one decision and rejects replay', async () => {
      const req = await repository.requestApproval(users[0]!, 'driver', {
        targetType: 'driver_profile',
        targetId: profiles[0]!,
        requestType: 'driver_verification',
      });
      const detail = await repository.approvalDetails(admin, req.id);
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          repository.reviewApproval(admin, req.id, {
            status: 'REJECTED',
            reason: 'Missing evidence',
            expectedUpdatedAt: detail.target.updated_at,
          }),
        ),
      );
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect((await repository.approval(users[0]!, 'driver', req.id)).status).toBe('REJECTED');
    });
    it('custom vehicle documents reuse OTHER and remain owned/optional', async () => {
      const service = new PartnerDocumentService(new PostgresPartnerDocumentRepository(pool));
      const data = {
        documentType: 'OTHER' as const,
        vehicleId: vehicles[0]!,
        metadata: { documentCode: 'custom_vehicle', uploadSource: 'FILE' },
      };
      const actor = { userId: owners[0]!, role: 'fleet_owner' };
      expect(await service.createDocumentMetadata(fleets[0]!, data, actor)).toMatchObject({
        documentType: 'OTHER',
        vehicleId: vehicles[0],
        status: 'PENDING',
      });
      await expect(service.createDocumentMetadata(fleets[0]!, data, actor)).rejects.toMatchObject({
        statusCode: 409,
      });
      await expect(
        service.createDocumentMetadata(fleets[1]!, data, {
          userId: owners[1]!,
          role: 'fleet_owner',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('application review synchronizes membership atomically and permits one winner', async () => {
      const applications = new PostgresDriverApplicationRepository();
      await pool.query(
        "UPDATE partner_drivers SET status='INACTIVE' WHERE partner_id=$1 AND driver_profile_id=$2",
        [fleets[0], profiles[0]],
      );
      const application = await applications.create({
        partnerId: fleets[0]!,
        driverProfileId: profiles[0]!,
        requestedSector: 'passenger',
        requestedVehicleCategory: 'sedan',
        vehicleOwnershipType: 'DRIVER_ONLY',
      });
      const outcomes = await Promise.all([
        applications.updateStatus(application.id, { status: 'APPROVED' }, admin),
        applications.updateStatus(application.id, { status: 'APPROVED' }, admin),
      ]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const membership = await pool.query(
        'SELECT status FROM partner_drivers WHERE partner_id=$1 AND driver_profile_id=$2',
        [fleets[0], profiles[0]],
      );
      expect(membership.rows[0].status).toBe('ACTIVE');
      const profile = await pool.query('SELECT verified_by FROM driver_profiles WHERE id=$1', [
        profiles[0],
      ]);
      expect(profile.rows[0].verified_by).toBe(admin);
    });
    it('application review failure rolls back application and rejects requester review', async () => {
      const applications = new PostgresDriverApplicationRepository();
      const application = await applications.create({
        partnerId: fleets[0]!,
        driverProfileId: profiles[0]!,
        requestedSector: 'passenger',
        requestedVehicleCategory: 'sedan',
        vehicleOwnershipType: 'DRIVER_ONLY',
      });
      await expect(
        applications.updateStatus(application.id, { status: 'APPROVED' }, owners[0]!),
      ).rejects.toMatchObject({ code: '23514' });
      await pool.query('UPDATE driver_profiles SET license_expiry=CURRENT_DATE-1 WHERE id=$1', [
        profiles[0],
      ]);
      await expect(
        applications.updateStatus(application.id, { status: 'APPROVED' }, admin),
      ).rejects.toMatchObject({ code: '23514' });
      expect((await applications.findById(application.id))?.status).toBe('PENDING');
    });
  },
);
