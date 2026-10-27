import { describe, expect, it } from 'vitest';
import { upsertBankAccountSchema } from '../schemas/provider.schemas.js';
import { assertIdentityCollectionAllowed } from '../services/identity-collection.js';

describe('Document collection and bank-input boundaries', () => {
  const bank = {
    accountHolderName: 'TEST_SAMPLE',
    accountNumber: '123456789012',
    ifscCode: 'TEST0001234',
    bankName: 'TEST_SAMPLE',
  };
  it.each(['ABCD', 'TEST1001234', '12340001234', 'TEST00012345', 'TEST000 234'])(
    'rejects malformed IFSC %#',
    (ifscCode) => {
      expect(upsertBankAccountSchema.safeParse({ ...bank, ifscCode }).success).toBe(false);
    },
  );
  it('normalizes IFSC case without claiming bank-directory verification', () => {
    expect(upsertBankAccountSchema.parse({ ...bank, ifscCode: ' test0001234 ' }).ifscCode).toBe(
      'TEST0001234',
    );
  });
  it('disables Aadhaar collection without operator authorization', () => {
    expect(() => assertIdentityCollectionAllowed('AADHAAR', undefined, '')).toThrowError(
      expect.objectContaining({ code: 'IDENTITY_COLLECTION_DISABLED' }),
    );
    expect(() =>
      assertIdentityCollectionAllowed('other', { documentCode: 'aadhaar_masked' }, ''),
    ).toThrowError(expect.objectContaining({ code: 'IDENTITY_COLLECTION_DISABLED' }));
  });
  it('requires explicit consent and masking attestations even with an authorized policy', () => {
    expect(() => assertIdentityCollectionAllowed('AADHAAR', {}, 'TEST_SAMPLE_POLICY')).toThrowError(
      expect.objectContaining({ code: 'MASKED_IDENTITY_CONSENT_REQUIRED' }),
    );
  });
  it('rejects an unmasked number and permits a consented masked fixture only with authorization', () => {
    const consent = { identityConsent: 'true', maskedIdentity: 'true' };
    expect(() =>
      assertIdentityCollectionAllowed(
        'AADHAAR',
        { ...consent, documentNumber: '123456789012' },
        'TEST_SAMPLE_POLICY',
      ),
    ).toThrowError(expect.objectContaining({ code: 'UNMASKED_IDENTITY_REJECTED' }));
    expect(() =>
      assertIdentityCollectionAllowed(
        'AADHAAR',
        { ...consent, documentNumber: 'XXXXXXXX1234' },
        'TEST_SAMPLE_POLICY',
      ),
    ).not.toThrow();
    expect(() => assertIdentityCollectionAllowed('PAN', {}, '')).not.toThrow();
  });
});
