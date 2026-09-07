import { describe, expect, it } from 'vitest';
import { createPartnerDocumentSchema } from '../schemas/partner-document.schemas.js';

describe('Partner document schemas', () => {
  it('rejects raw sensitive document numbers', () => {
    expect(() =>
      createPartnerDocumentSchema.parse({
        documentType: 'AADHAAR',
        documentNumber: '123456789012',
      }),
    ).toThrow();
  });
});
