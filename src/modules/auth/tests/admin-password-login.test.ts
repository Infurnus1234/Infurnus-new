import { describe, expect, it, vi } from 'vitest';
import { LoginService } from '../services/login.service.js';
import type { LoginIdentity, LoginRepository } from '../repositories/login.repository.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';

vi.mock('../utils/password.js', () => ({
  verifyPassword: vi.fn(async (_hash, password) => password === 'disposable-test-password'),
}));
vi.mock('../../../common/crypto/encryption.js', () => ({
  encryptSecret: vi.fn(() => 'disposable-encrypted-token'),
}));
const credentials = { email: 'ADMIN@example.invalid', password: 'disposable-test-password' };
function fixture(role: string, overrides: Partial<LoginIdentity> = {}) {
  const identity: LoginIdentity = {
    id: 'fixture-user-id',
    role,
    status: 'active',
    email: 'admin@example.invalid',
    phone: null,
    passwordHash: 'test-only-verifier-placeholder',
    ...overrides,
  };
  const repository = {
    findByEmail: vi.fn(async () => identity),
    findByPhone: vi.fn(),
  } as unknown as LoginRepository;
  const challenges = {
    create: vi.fn(async () => ({ id: 'fixture-challenge' })),
  } as unknown as LoginChallengeRepository;
  const provider = {
    sendEmailOtp: vi.fn(async () => ({
      sessionId: 'fixture-session',
      sessionToken: 'fixture-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })),
    sendSmsOtp: vi.fn(),
  } as unknown as OtpProvider;
  return {
    service: new LoginService(repository, challenges, provider),
    repository,
    provider,
    challenges,
  };
}
describe('temporary administrative password-only policy', () => {
  it.each(['admin', 'super_admin'])(
    'authenticates trusted %s without OTP on both login paths',
    async (role) => {
      const f = fixture(role);
      for (const dedicated of [false, true])
        expect(await f.service.authenticate(credentials, dedicated)).toEqual({
          userId: 'fixture-user-id',
          role,
        });
      expect(f.repository.findByEmail).toHaveBeenCalledWith('admin@example.invalid');
      expect(f.provider.sendEmailOtp).not.toHaveBeenCalled();
      expect(f.challenges.create).not.toHaveBeenCalled();
    },
  );
  it.each(['admin', 'super_admin'])('rejects incorrect %s passwords', async (role) => {
    const f = fixture(role);
    await expect(
      f.service.authenticate({ ...credentials, password: 'incorrect' }, true),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(f.provider.sendEmailOtp).not.toHaveBeenCalled();
  });
  it.each(['suspended', 'banned'] as const)('rejects %s accounts', async (status) => {
    await expect(
      fixture('admin', { status }).service.authenticate(credentials, true),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
  });
  it('rejects locked administrative accounts', async () => {
    await expect(
      fixture('super_admin', { lockedUntil: new Date(Date.now() + 60_000) }).service.authenticate(
        credentials,
        true,
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });
  it('rejects unknown accounts', async () => {
    const f = fixture('admin');
    vi.mocked(f.repository.findByEmail).mockResolvedValue(null);
    await expect(f.service.authenticate(credentials, true)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });
  it.each(['customer', 'driver', 'fleet_owner', 'driver_fleet_owner'])(
    'refuses %s on the administrative path and retains normal OTP',
    async (role) => {
      const f = fixture(role);
      const input = { ...credentials, role: 'super_admin' };
      await expect(f.service.authenticate(input, true)).rejects.toMatchObject({
        code: 'ADMIN_ACCESS_REQUIRED',
      });
      const result = await f.service.authenticate(input);
      expect(result).toHaveProperty('challengeId');
      expect(result).not.toHaveProperty('userId');
      expect(f.provider.sendEmailOtp).toHaveBeenCalledTimes(1);
      expect(f.challenges.create).toHaveBeenCalledTimes(1);
    },
  );
});
