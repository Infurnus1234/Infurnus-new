import { describe, expect, it } from 'vitest';
import {
  createPartnerDocumentSchema,
  updatePartnerDocumentSchema,
} from '../schemas/partner-document.schemas.js';
import { partnerDocumentTypes } from '../types/partner-document.js';

const vehicleId = '850e8400-e29b-41d4-a716-446655440000';

function createInput(documentType: (typeof partnerDocumentTypes)[number]) {
  return { documentType };
}

describe('Partner document schema matrix', () => {
  it.each(partnerDocumentTypes)('accepts supported document type %s', (documentType) => {
    expect(createPartnerDocumentSchema.parse(createInput(documentType))).toMatchObject({
      documentType,
    });
  });

  it.each(['UNKNOWN', '', 'aadhaar', 'DRIVER_LICENSE'])(
    'rejects unsupported document type %s',
    (documentType) => {
      expect(() => createPartnerDocumentSchema.parse({ documentType })).toThrow();
    },
  );

  it.each(['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED'] as const)(
    'accepts controlled update status %s',
    (status) => {
      expect(updatePartnerDocumentSchema.parse({ status })).toEqual({ status });
    },
  );

  it.each(['pending', 'verified', 'APPROVED', '', 'UNKNOWN'])(
    'rejects uncontrolled status %s',
    (status) => {
      expect(() => updatePartnerDocumentSchema.parse({ status })).toThrow();
    },
  );

  it.each([
    { issuedAt: '2026-01-01', expiresAt: '2026-01-01' },
    { issuedAt: '2026-01-01', expiresAt: '2026-12-31' },
    { issuedAt: null, expiresAt: '2026-12-31' },
    { issuedAt: '2026-01-01', expiresAt: null },
  ])('accepts valid date combination %#', (dates) => {
    expect(createPartnerDocumentSchema.parse({ documentType: 'PAN', ...dates })).toMatchObject(
      dates,
    );
  });

  it.each([
    { issuedAt: '2026-02-01', expiresAt: '2026-01-31' },
    { issuedAt: 'not-a-date', expiresAt: '2026-01-01' },
    { issuedAt: '2026-01-01', expiresAt: 'not-a-date' },
    { issuedAt: '2026-1-1', expiresAt: '2026-01-02' },
  ])('rejects invalid date combination %#', (dates) => {
    expect(() => createPartnerDocumentSchema.parse({ documentType: 'PAN', ...dates })).toThrow();
  });

  it.each([
    { vehicleId, documentType: 'VEHICLE_RC' },
    { vehicleId, documentType: 'VEHICLE_INSURANCE' },
    { vehicleId: null, documentType: 'AADHAAR' },
  ] as const)('accepts valid partner or vehicle document shape %#', (input) => {
    expect(createPartnerDocumentSchema.parse(input)).toMatchObject(input);
  });

  it.each([
    { documentType: 'AADHAAR', unknown: true },
    { documentType: 'PAN', documentNumber: 'must-be-rejected' },
    { documentType: 'PAN', metadata: 'must-be-object' },
    { documentType: 'PAN', issuedAt: 20260101 },
  ])('rejects unsafe or unknown create fields %#', (input) => {
    expect(() => createPartnerDocumentSchema.parse(input)).toThrow();
  });

  it.each([
    {},
    { status: 'VERIFIED', unknown: true },
    { status: 'PENDING', expiresAt: '2026-01-01', issuedAt: '2026-02-01' },
  ])('rejects invalid update payload %#', (input) => {
    expect(() => updatePartnerDocumentSchema.parse(input)).toThrow();
  });
});
