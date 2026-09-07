import { describe, expect, it } from 'vitest';
import { adminPartnersQuerySchema, adminVehiclesQuerySchema } from '../schemas/admin.schemas.js';

describe('Admin query schemas', () => {
  it('applies bounded pagination and accepts report compliance filters', () => {
    expect(
      adminPartnersQuerySchema.parse({
        page: '2',
        pageSize: '50',
        documentStatus: 'VERIFIED',
        complianceStatus: 'expiring',
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 50,
      documentStatus: 'VERIFIED',
      complianceStatus: 'expiring',
    });
  });

  it('rejects unknown filters, invalid pagination, and reversed dates', () => {
    expect(() => adminVehiclesQuerySchema.parse({ unknown: 'value' })).toThrow();
    expect(() => adminVehiclesQuerySchema.parse({ pageSize: '101' })).toThrow();
    expect(() =>
      adminPartnersQuerySchema.parse({ from: '2026-02-01', to: '2026-01-01' }),
    ).toThrow();
  });
});
