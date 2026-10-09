import { describe, expect, it } from 'vitest';
import { upsertDriverProfileSchema } from '../schemas/driver.schemas.js';
const cases = [
  {
    name: 'minimal profile leaves optional fields absent',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
    },
    valid: true,
  },
  {
    name: 'licenseNumber accepts its maximum length',
    input: {
      licenseNumber: 'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
      licenseExpiry: '2099-12-31',
    },
    valid: true,
  },
  {
    name: 'licenseNumber rejects one character over limit',
    input: {
      licenseNumber: 'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
      licenseExpiry: '2099-12-31',
    },
    valid: false,
  },
  {
    name: 'licenseNumber empty value',
    input: {
      licenseNumber: '',
      licenseExpiry: '2099-12-31',
    },
    valid: false,
  },
  {
    name: 'gender accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      gender: 'TTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'gender rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      gender: 'TTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'gender empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      gender: '',
    },
    valid: true,
  },
  {
    name: 'address accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      address:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'address rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      address:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'address empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      address: '',
    },
    valid: true,
  },
  {
    name: 'city accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      city: 'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'city rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      city: 'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'city empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      city: '',
    },
    valid: true,
  },
  {
    name: 'state accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      state:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'state rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      state:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'state empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      state: '',
    },
    valid: true,
  },
  {
    name: 'pinCode accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      pinCode: 'TTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'pinCode rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      pinCode: 'TTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'pinCode empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      pinCode: '',
    },
    valid: true,
  },
  {
    name: 'emergencyContactName accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactName:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'emergencyContactName rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactName:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'emergencyContactName empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactName: '',
    },
    valid: true,
  },
  {
    name: 'emergencyContactPhone accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactPhone: 'TTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'emergencyContactPhone rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactPhone: 'TTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'emergencyContactPhone empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactPhone: '',
    },
    valid: true,
  },
  {
    name: 'emergencyContactRelationship accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactRelationship:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'emergencyContactRelationship rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactRelationship:
        'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'emergencyContactRelationship empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactRelationship: '',
    },
    valid: true,
  },
  {
    name: 'alternateContactPhone accepts its maximum length',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      alternateContactPhone: 'TTTTTTTTTTTTTTTTTTTT',
    },
    valid: true,
  },
  {
    name: 'alternateContactPhone rejects one character over limit',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      alternateContactPhone: 'TTTTTTTTTTTTTTTTTTTTT',
    },
    valid: false,
  },
  {
    name: 'alternateContactPhone empty value',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      alternateContactPhone: '',
    },
    valid: true,
  },
  {
    name: 'whitespace-only licence rejected',
    input: {
      licenseNumber: '   ',
      licenseExpiry: '2099-12-31',
    },
    valid: false,
  },
  {
    name: "licenseExpiry rejects '2026-02-30'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2026-02-30',
    },
    valid: false,
  },
  {
    name: "licenseExpiry rejects '2026-13-01'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2026-13-01',
    },
    valid: false,
  },
  {
    name: "licenseExpiry rejects '09/10/2026'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '09/10/2026',
    },
    valid: false,
  },
  {
    name: "licenseExpiry rejects '2026-1-01'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2026-1-01',
    },
    valid: false,
  },
  {
    name: "licenseExpiry rejects ''",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '',
    },
    valid: false,
  },
  {
    name: "dob rejects '2026-02-30'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      dob: '2026-02-30',
    },
    valid: false,
  },
  {
    name: "dob rejects '2026-13-01'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      dob: '2026-13-01',
    },
    valid: false,
  },
  {
    name: "dob rejects '09/10/2026'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      dob: '09/10/2026',
    },
    valid: false,
  },
  {
    name: "dob rejects '2026-1-01'",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      dob: '2026-1-01',
    },
    valid: false,
  },
  {
    name: "dob rejects ''",
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      dob: '',
    },
    valid: false,
  },
  {
    name: 'expired licence rejected',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2000-01-01',
    },
    valid: false,
  },
  {
    name: 'future date of birth rejected',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      dob: '2099-01-01',
    },
    valid: false,
  },
  {
    name: 'synthetic historical date of birth accepted',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      dob: '1990-01-01',
    },
    valid: true,
  },
  {
    name: 'safe non-dialable emergency test number permitted by text contract',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      emergencyContactPhone: '0000000000',
    },
    valid: true,
  },
  {
    name: 'supported location postal code accepted',
    input: {
      licenseNumber: 'TEST-ONLY-NOT-A-LICENCE',
      licenseExpiry: '2099-12-31',
      pinCode: '800001',
    },
    valid: true,
  },
];
describe('Driver onboarding field contract', () => {
  it.each(cases)('$name', ({ input, valid }) => {
    expect(upsertDriverProfileSchema.safeParse(input).success).toBe(valid);
  });
  it('rejects client-supplied approval and eligibility', () => {
    for (const key of ['verificationStatus', 'approvalStatus', 'status', 'isVerified']) {
      expect(
        upsertDriverProfileSchema.safeParse({
          licenseNumber: 'TEST-ONLY',
          licenseExpiry: '2099-12-31',
          [key]: 'approved',
        }).success,
      ).toBe(false);
    }
  });
});
