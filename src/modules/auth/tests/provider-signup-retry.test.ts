import { describe, expect, it, vi } from 'vitest';
import { SignupService } from '../services/signup.service.js';
import type { SignupInput } from '../services/signup.service.js';

vi.mock('../utils/password.js', () => ({ hashPassword: vi.fn(async () => 'fixture-hash') }));
vi.mock('../../../common/crypto/encryption.js', () => ({
  encryptSecret: vi.fn(() => 'encrypted-fixture'),
}));

function fixture(role: SignupInput['role']) {
  const old = { id: 'old', otpProviderExpiresAt: new Date(Date.now() - 1000) };
  const repository = {
    findByContact: vi.fn(async () => old),
    deleteExpiredById: vi.fn(async () => true),
    create: vi.fn(async () => ({ id: 'new' })),
  };
  const send = vi.fn(async () => ({
    sessionId: 'provider-id',
    sessionToken: 'private',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  }));
  const users = {
    existsByPhone: vi.fn(async () => false),
    existsByEmail: vi.fn(async () => false),
  };
  const service = new SignupService(
    repository as never,
    { sendSmsOtp: send, sendEmailOtp: send } as never,
    users,
  );
  const input: SignupInput = {
    firstName: 'Test',
    lastName: 'Signup',
    role,
    phone: '+919876543210',
    ...(role !== 'customer' && role !== 'fleet_owner' ? { onboardingLicencePending: true } : {}),
    ...(role === 'fleet_owner' || role === 'driver_fleet_owner'
      ? { businessName: 'Fleet', password: 'Fixture123!' }
      : {}),
  };
  return { old, repository, service, input, send, users };
}

describe('provider signup retries', () => {
  it.each(['customer', 'driver', 'fleet_owner', 'driver_fleet_owner'] as const)(
    '%s can replace an expired unverified pending signup',
    async (role) => {
      const f = fixture(role);
      const result = await f.service.signup(f.input);
      expect(f.repository.deleteExpiredById).toHaveBeenCalledWith('old');
      expect(f.send).toHaveBeenCalledExactlyOnceWith('+919876543210');
      expect(result.signupId).toBe('new');
      expect(f.repository.create).toHaveBeenCalledOnce();
    },
  );
  it.each(['fleet_owner', 'driver_fleet_owner'] as const)(
    '%s retains a live pending request without duplicate SMS or password replacement',
    async (role) => {
      const f = fixture(role);
      f.old.otpProviderExpiresAt = new Date(Date.now() + 300000);
      await expect(f.service.signup(f.input)).rejects.toMatchObject({
        code: 'SIGNUP_ALREADY_PENDING',
      });
      expect(f.repository.deleteExpiredById).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
      expect(f.repository.create).not.toHaveBeenCalled();
    },
  );
  it('does not send if expired-row deletion loses a verification/retry race', async () => {
    const f = fixture('fleet_owner');
    f.repository.deleteExpiredById.mockResolvedValue(false);
    await expect(f.service.signup(f.input)).rejects.toMatchObject({
      code: 'SIGNUP_ALREADY_PENDING',
    });
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['driver', 'fleet_owner', 'driver_fleet_owner'] as const)(
    '%s rejects national-only phone before database lookup or provider submission',
    async (role) => {
      const f = fixture(role);
      await expect(f.service.signup({ ...f.input, phone: '9876543210' })).rejects.toMatchObject({
        code: 'PHONE_COUNTRY_CODE_REQUIRED',
      });
      expect(f.repository.findByContact).not.toHaveBeenCalled();
      expect(f.users.existsByPhone).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it('canonicalizes an explicit Indian prefix without duplicating country code', async () => {
    const f = fixture('driver');
    await f.service.signup({ ...f.input, phone: '919876543210' });
    expect(f.send).toHaveBeenCalledWith('+919876543210');
  });
  it('preserves an explicit non-Indian international number', async () => {
    const f = fixture('driver');
    await f.service.signup({ ...f.input, phone: '+16505550100' });
    expect(f.send).toHaveBeenCalledWith('+16505550100');
  });
});
