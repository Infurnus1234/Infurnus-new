import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresFleetRepository } from '../repositories/fleet.repository.js';
import { fleetListQuerySchema, createFleetVehicleSchema } from '../schemas/fleet.schemas.js';
import { PostgresPartnerRepository } from '../../partners/repositories/partner.repository.js';
import { PartnerVehicleService } from '../../partners/services/partner-vehicle.service.js';
import { FleetService } from '../services/fleet.service.js';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
import { PostgresPartnerDocumentRepository } from '../../partners/repositories/partner-document.repository.js';
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'FLEET-01/03 draft inventory and ownership on PostgreSQL',
  () => {
    it('pending provider can create a non-operational draft; active filters match database activation, not approval', async () => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Isolated database required');
      const owner = randomUUID(),
        other = randomUUID();
      for (const id of [owner, other])
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Inventory',$2,'driver_fleet_owner')",
          [id, id + '@example.invalid'],
        );
      await pool.query(
        "INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_SAMPLE pending business')",
        [owner],
      );
      const repo = new PostgresFleetRepository(pool),
        service = new PartnerVehicleService(
          new PostgresPartnerRepository(pool),
          new FleetService(repo),
        );
      const input = () =>
        createFleetVehicleSchema.parse({
          make: 'TEST_SAMPLE',
          model: 'Draft',
          plateNumber: randomUUID().slice(0, 20),
          sector: 'passenger',
          category: 'sedan',
        });
      const first = await service.createVehicle(
        { userId: owner, role: 'driver_fleet_owner' },
        input(),
      );
      const second = await service.createVehicle(
        { userId: owner, role: 'driver_fleet_owner' },
        input(),
      );
      expect(first.isActive).toBe(false);
      const operations = new PostgresProviderOperationsRepository(pool);
      await expect(
        operations.manageVehicle(owner, 'driver_fleet_owner', second.id, {
          operationalStatus: 'ACTIVE',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      const admin = randomUUID();
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Reviewer',$2,'admin')",
        [admin, admin + '@example.invalid'],
      );
      const partner = (await pool.query('SELECT id FROM partners WHERE user_id=$1', [owner]))
        .rows[0].id;
      const photo = await new PostgresPartnerDocumentRepository(pool).create({
        partnerId: partner,
        vehicleId: second.id,
        documentType: 'OTHER',
        metadata: {
          documentCode: 'vehicle_front_photo',
          storage: {
            storageProvider: 'cloudinary',
            storageKey: 'TEST_SAMPLE/local-fixture-photo',
            resourceType: 'image',
            accessMode: 'authenticated',
            mimeType: 'image/jpeg',
            fileSize: 100,
            originalFileName: 'TEST_SAMPLE.jpg',
          },
        },
      });
      for (const target of [
        {
          targetType: 'partner_document' as const,
          targetId: photo.id,
          requestType: 'document_reverification',
        },
        { targetType: 'partner' as const, targetId: partner, requestType: 'fleet_verification' },
        {
          targetType: 'vehicle' as const,
          targetId: second.id,
          requestType: 'vehicle_verification',
        },
      ]) {
        const request = await operations.requestApproval(owner, 'driver_fleet_owner', target);
        const detail = await operations.approvalDetails(admin, request.id);
        expect(
          await operations.reviewApproval(admin, request.id, {
            status: 'APPROVED',
            expectedUpdatedAt: detail.target.updated_at,
          }),
        ).toMatchObject({ status: 'APPROVED' });
      }
      await operations.manageVehicle(owner, 'driver_fleet_owner', second.id, {
        operationalStatus: 'ACTIVE',
      });
      expect(first.verificationStatus).toBe('pending');
      expect(first.driverProfileId).toBeNull();
      const all = await repo.listVehicles(owner),
        active = await repo.listVehicles(owner, fleetListQuerySchema.parse({ active: 'true' })),
        inactive = await repo.listVehicles(owner, fleetListQuerySchema.parse({ active: 'false' }));
      expect(all.map((x) => x.id)).toEqual(expect.arrayContaining([first.id, second.id]));
      expect(active.map((x) => x.id)).toContain(second.id);
      expect(active.find((x) => x.id === second.id)?.verificationStatus).toBe('approved');
      expect(active.map((x) => x.id)).not.toContain(first.id);
      expect(inactive.map((x) => x.id)).toContain(first.id);
      expect(inactive.map((x) => x.id)).not.toContain(second.id);
      expect(await repo.listVehicles(other)).toHaveLength(0);
      const row = (
        await pool.query(
          'SELECT is_active,verification_status,driver_profile_id FROM vehicles WHERE id=$1',
          [first.id],
        )
      ).rows[0];
      expect(row).toMatchObject({
        is_active: false,
        verification_status: 'pending',
        driver_profile_id: null,
      });
    });
  },
);
