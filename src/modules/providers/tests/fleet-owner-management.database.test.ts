import express from 'express';
import request from 'supertest';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { createProviderApprovalRouter } from '../routes/provider-operations.routes.js';
import { createProviderRouter } from '../routes/provider.routes.js';
import { ProviderController } from '../controllers/provider.controller.js';
import { ProviderService } from '../services/provider.service.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '../../../infrastructure/database/postgres.js';
import { actor, fixture } from './fleet-workflow-fixture.js';
import { PostgresProviderBankRepository } from '../repositories/provider-bank.repository.js';
import { FleetOwnerOverviewRepository } from '../repositories/fleet-owner-overview.repository.js';
import { upsertBankAccountSchema } from '../schemas/provider.schemas.js';
import { validateDocumentMetadata } from '../services/document-metadata-policy.js';
const bank = new PostgresProviderBankRepository(pool);
const details = new FleetOwnerOverviewRepository(pool);
const input = {
  accountHolderName: 'TEST_SAMPLE Fleet',
  accountNumber: '123456789012',
  ifscCode: 'TEST0001234',
  bankName: 'Test Bank',
  branchName: 'Test branch',
  accountType: 'CURRENT' as const,
  ownershipType: 'BUSINESS' as const,
  legalEntityName: 'TEST_SAMPLE Fleet',
};

describe('Fleet owner business validation', () => {
  it('requires a business identity without making optional branch/type mandatory', () => {
    expect(
      upsertBankAccountSchema.safeParse({ ...input, legalEntityName: undefined }).success,
    ).toBe(false);
    expect(
      upsertBankAccountSchema.safeParse({
        accountHolderName: 'Test Owner',
        accountNumber: '123456789012',
        ifscCode: 'TEST0001234',
        bankName: 'Test Bank',
      }).success,
    ).toBe(true);
  });
  it('validates PAN format without claiming official verification', () => {
    expect(() => validateDocumentMetadata('PAN', { documentNumber: 'incorrect' })).toThrow();
    expect(() =>
      validateDocumentMetadata('PAN', { documentNumber: 'ABCDE1234F', holderName: 'Test Owner' }),
    ).not.toThrow();
  });
});
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')('Fleet owner persisted management', () => {
  beforeAll(() => {
    if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
      throw Error('Owned disposable database required');
  });
  it('persists bank metadata, masks numbers, records changes and never verifies uploads', async () => {
    const f = await fixture();
    const b = await bank.upsertBankAccount(f.owner, input);
    const saved = await bank.getBankAccount(f.owner);
    expect(saved).toMatchObject({
      branchName: 'Test branch',
      ownershipType: 'BUSINESS',
      accountType: 'CURRENT',
      isVerified: false,
      accountNumberLast4: '9012',
      nameComparison: 'NAME_MATCH',
    });
    expect(JSON.stringify(saved)).not.toContain(input.accountNumber);
    const events = (
      await pool.query('SELECT * FROM provider_bank_change_history WHERE bank_account_id=$1', [
        b.id,
      ])
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe(f.owner);
    expect(JSON.stringify(events)).not.toContain(input.accountNumber);
    await expect(
      pool.query('DELETE FROM provider_bank_change_history WHERE bank_account_id=$1', [b.id]),
    ).rejects.toThrow('append-only');
  });
  it('allows only the current owners private non-vehicle bank proof', async () => {
    const f = await fixture(),
      other = await fixture();
    const proof = async (partner: string) =>
      (
        await pool.query(
          `INSERT INTO partner_documents(partner_id,document_type,status,metadata) VALUES($1,'OTHER','SUBMITTED',$2::jsonb) RETURNING id`,
          [
            partner,
            JSON.stringify({
              documentCode: 'bank_proof',
              storage: {
                storageKey: 'private/test-fixture',
                resourceType: 'image',
                accessMode: 'authenticated',
              },
            }),
          ],
        )
      ).rows[0].id;
    const own = await proof(f.partner),
      foreign = await proof(other.partner);
    await expect(
      bank.upsertBankAccount(f.owner, { ...input, supportingDocumentId: foreign }),
    ).rejects.toMatchObject({ code: 'BANK_PROOF_NOT_ACCESSIBLE' });
    await expect(
      bank.upsertBankAccount(f.owner, { ...input, supportingDocumentId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'BANK_PROOF_NOT_ACCESSIBLE' });
    await bank.upsertBankAccount(f.owner, { ...input, supportingDocumentId: own });
    expect((await bank.getBankAccount(f.owner))?.supportingDocumentId).toBe(own);
    expect((await bank.getBankAccount(f.owner))?.supportingDocumentStatus).toBe('SUBMITTED');
  });
  it('restricts consolidated financial/identity records to active Super Admins', async () => {
    const f = await fixture(),
      superAdmin = await actor('super_admin');
    await expect(details.read(f.owner, f.partner, 'bank', 25, 0, '', 'ALL')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(details.read(f.admin, f.partner, 'bank', 25, 0, '', 'ALL')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const profile = await details.read(superAdmin, f.partner, 'profile', 25, 0, '', 'ALL');
    expect(profile.owner.userId).toBe(f.owner);
    const vehicles = await details.read(superAdmin, f.partner, 'vehicles', 1, 0, '', 'ALL');
    expect(vehicles.items).toHaveLength(1);
    expect(vehicles.items[0].id).toBe(f.vehicle.id);
    const drivers = await details.read(superAdmin, f.partner, 'drivers', 25, 0, '', 'ALL');
    expect(drivers.items.some((row) => row.id === f.profile)).toBe(true);
  });
  it('filters actionable documents and flags upcoming expiry without treating bank proof as identity', async () => {
    const f = await fixture(),
      superAdmin = await actor('super_admin');
    await pool.query(
      `INSERT INTO partner_documents(partner_id,document_type,status,expires_at,metadata) VALUES($1,'PAN','PENDING',CURRENT_DATE+10,'{"documentNumber":"ABCDE1234F"}'::jsonb),($1,'OTHER','REJECTED',NULL,'{"documentCode":"bank_proof"}'::jsonb)`,
      [f.partner],
    );
    const docs = await details.read(
      superAdmin,
      f.partner,
      'documents',
      1,
      0,
      'PAN',
      'ACTION_REQUIRED',
    );
    expect(docs.items).toHaveLength(1);
    expect(docs.items[0].expiringSoon).toBe(true);
    expect(docs.owner.identityReviewStatus).toBe('PENDING');
    expect(docs.owner.actionRequiredDocuments).toBeGreaterThanOrEqual(2);
    const page = await details.read(
      superAdmin,
      f.partner,
      'documents',
      1,
      0,
      '',
      'ACTION_REQUIRED',
    );
    expect(page.hasNext).toBe(true);
  });
  it('connects authenticated HTTP bank and Admin workspace contracts without exposing account numbers', async () => {
    const f = await fixture(),
      superAdmin = await actor('super_admin');
    const app = express();
    app.use(express.json());
    app.use('/provider', createProviderRouter(new ProviderController(new ProviderService(bank))));
    app.use(
      '/provider-approvals',
      createProviderApprovalRouter(new PostgresProviderOperationsRepository(pool)),
    );
    app.use(errorMiddleware);
    const ownerToken = await signAccessToken({ sub: f.owner, role: 'fleet_owner', type: 'access' });
    const adminToken = await signAccessToken({
      sub: superAdmin,
      role: 'super_admin',
      type: 'access',
    });
    const path = `/provider-approvals/fleet-owners/${f.partner}/overview`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set('Authorization', `Bearer ${ownerToken}`)).status).toBe(
      403,
    );
    const invalid = await request(app)
      .post('/provider/bank-account')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...input, userId: superAdmin });
    expect(invalid.status).toBe(400);
    const saved = await request(app)
      .post('/provider/bank-account')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(input);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(input.accountNumber);
    const overview = await request(app)
      .get(path + '?section=bank')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(overview.status).toBe(200);
    expect(overview.body.data.bank.ownershipType).toBe('BUSINESS');
    expect(JSON.stringify(overview.body)).not.toContain(input.accountNumber);
    expect(
      (
        await request(app)
          .get(path + '?section=bank&userId=' + superAdmin)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(400);
  });

  it('revokes bank verification when the linked proof is replaced', async () => {
    const f = await fixture();
    const proof = (
      await pool.query(
        `INSERT INTO partner_documents(partner_id,document_type,status,metadata) VALUES($1,'OTHER','SUBMITTED',$2::jsonb) RETURNING id`,
        [
          f.partner,
          JSON.stringify({
            documentCode: 'bank_proof',
            storage: { storageKey: 'private/original' },
          }),
        ],
      )
    ).rows[0].id;
    const b = await bank.upsertBankAccount(f.owner, { ...input, supportingDocumentId: proof });
    // An explicit verified test fixture, not a simulated production provider response.
    await pool.query(
      'UPDATE provider_bank_accounts SET is_verified=TRUE,verified_by=$2,verified_at=NOW() WHERE id=$1',
      [b.id, f.admin],
    );
    await pool.query(
      `UPDATE partner_documents SET metadata=jsonb_set(metadata,'{storage,storageKey}','"private/replacement"'::jsonb) WHERE id=$1`,
      [proof],
    );
    expect((await bank.getBankAccount(f.owner))?.isVerified).toBe(false);
    const retained = (
      await pool.query('SELECT verified_by,verified_at FROM provider_bank_accounts WHERE id=$1', [
        b.id,
      ])
    ).rows[0];
    expect(retained.verified_by).toBeNull();
    expect(retained.verified_at).toBeNull();
  });
  it('enforces configured licence classes at assignment and requires review after a class change', async () => {
    const f = await fixture();
    await new PostgresProviderOperationsRepository(pool).configureDocumentRequirement(f.admin, {
      providerRole: 'driver',
      category: 'sedan',
      documentCode: 'driver_license',
      required: false,
      requiresExpiry: false,
      minimumPages: 1,
      active: true,
      requiredLicenceClasses: ['LMV'],
    });
    const doc = (
      await pool.query(
        `INSERT INTO driver_documents(driver_profile_id,document_type,storage_provider,storage_key,resource_type,access_mode,mime_type,file_size,uploaded_by,verification_status,verified_by,verified_at,document_metadata) VALUES($1,'driver_license','cloudinary','private/licence-fixture','image','authenticated','image/png',20,$2,'approved',$3,NOW(),'{"licenceClasses":"HGV"}'::jsonb) RETURNING id`,
        [f.profile, f.driver, f.admin],
      )
    ).rows[0].id;
    const fleet = new PostgresFleetRepository(pool);
    await expect(fleet.generateAssignmentCode(f.owner, f.vehicle.id, f.profile)).rejects.toThrow(
      'DRIVER_NOT_ELIGIBLE_FOR_ASSIGNMENT',
    );
    await pool.query(
      `UPDATE driver_documents SET document_metadata='{"licenceClasses":"LMV"}'::jsonb WHERE id=$1`,
      [doc],
    );
    expect(
      (
        await pool.query('SELECT verification_status,version FROM driver_documents WHERE id=$1', [
          doc,
        ])
      ).rows[0],
    ).toMatchObject({ verification_status: 'pending', version: 2 });
    await expect(fleet.generateAssignmentCode(f.owner, f.vehicle.id, f.profile)).rejects.toThrow(
      'DRIVER_NOT_ELIGIBLE_FOR_ASSIGNMENT',
    );
    await pool.query(
      `UPDATE driver_documents SET verification_status='approved',verified_by=$2,verified_at=NOW() WHERE id=$1`,
      [doc, f.admin],
    );
    expect((await fleet.generateAssignmentCode(f.owner, f.vehicle.id, f.profile)).code).toMatch(
      /^\d{6}$/,
    );
    await pool.query(
      `UPDATE provider_document_requirements SET active=FALSE WHERE provider_role='driver' AND document_code='driver_license' AND vehicle_category='sedan'`,
    );
  });
});
