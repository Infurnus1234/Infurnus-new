import { describe, expect, it, vi } from 'vitest';
import { LoginService } from '../services/login.service.js';
import { SignupService } from '../services/signup.service.js';
import { loginSchema, signupSchema } from '../schemas/auth.schemas.js';
import { verifyPassword } from '../utils/password.js';
vi.mock('../utils/password.js', () => ({
  verifyPassword: vi.fn(async () => false),
  hashPassword: vi.fn(async () => 'random-credential-hash'),
}));
vi.mock('../../../common/crypto/encryption.js', () => ({
  encryptSecret: vi.fn(() => 'encrypted-session'),
}));
const session = () => ({
  sessionId: 'provider-id',
  sessionToken: 'secret',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
function fixture(role: string) {
  const identity = {
    id: 'existing-id',
    role,
    status: 'active',
    email: 'user@example.com',
    phone: '+919876543210',
    passwordHash: null,
  };
  const repository = {
    findByEmail: vi.fn(async () => identity),
    findByPhone: vi.fn(async () => identity),
  };
  const challenges = { create: vi.fn(async () => ({ id: 'challenge-id' })) };
  const provider = {
    sendSmsOtp: vi.fn(async () => session()),
    sendEmailOtp: vi.fn(async () => session()),
  };
  return {
    identity,
    repository,
    challenges,
    provider,
    service: new LoginService(repository as never, challenges as never, provider as never),
  };
}
describe('passwordless authentication', () => {
  it.each(['customer', 'driver'])(
    '%s login accepts either identifier without a password',
    async (role) => {
      const f = fixture(role);
      vi.mocked(verifyPassword).mockClear();
      expect(loginSchema.safeParse({ phone: f.identity.phone }).success).toBe(true);
      expect(await f.service.authenticate({ phone: f.identity.phone })).toHaveProperty(
        'challengeId',
      );
      expect(
        await f.service.authenticate({ email: ' USER@example.com ', password: 'ignored' }),
      ).toHaveProperty('challengeId');
      expect(f.provider.sendSmsOtp).toHaveBeenCalledWith(f.identity.phone);
      expect(f.provider.sendEmailOtp).toHaveBeenCalledWith(f.identity.email);
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(f.challenges.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'existing-id' }),
      );
      await expect(f.service.authenticate({ email: f.identity.email }, true)).rejects.toMatchObject(
        { code: 'ADMIN_ACCESS_REQUIRED' },
      );
    },
  );
  it.each(['admin', 'super_admin'])('%s still requires a valid password', async (role) => {
    const f = fixture(role);
    await expect(f.service.authenticate({ email: f.identity.email })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(f.provider.sendEmailOtp).not.toHaveBeenCalled();
  });
  it.each(['customer', 'driver'])(
    '%s signup preserves onboarding and verifies only the selected contact',
    async (role) => {
      const f = fixture(role);
      const pending = {
        findByContact: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'signup-id' })),
      };
      const users = {
        existsByEmail: vi.fn(async () => false),
        existsByPhone: vi.fn(async () => false),
      };
      const service = new SignupService(pending as never, f.provider as never, users);
      const fields = {
        firstName: 'First',
        lastName: 'Last',
        role,
        licenseNumber: 'LICENSE',
        licenseExpiry: '2030-01-01',
      };
      for (const contact of [
        { phone: f.identity.phone, email: f.identity.email },
        { email: f.identity.email },
      ]) {
        const parsed = signupSchema.parse({ ...fields, ...contact });
        await service.signup({
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          role: parsed.role,
          ...contact,
          licenseNumber: 'LICENSE',
          licenseExpiry: '2030-01-01',
        });
      }
      expect(pending.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          email: f.identity.email,
          contactType: 'phone',
          passwordHash: 'random-credential-hash',
          role,
        }),
      );
      expect(pending.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ email: f.identity.email, contactType: 'email' }),
      );
      if (role === 'driver')
        expect(
          signupSchema.safeParse({ firstName: 'A', lastName: 'B', phone: f.identity.phone, role })
            .success,
        ).toBe(false);
    },
  );
  it('does not authenticate legacy unverified secondary email contacts', async () => {
    const f = fixture('customer');
    Object.assign(f.identity, { emailVerified: false });
    expect(await f.service.authenticate({ email: f.identity.email })).toHaveProperty('challengeId');
    expect(f.provider.sendEmailOtp).not.toHaveBeenCalled();
    expect(f.challenges.create).not.toHaveBeenCalled();
  });
  it('does not reveal unknown login accounts', async () => {
    const f = fixture('customer');
    vi.mocked(f.repository.findByEmail).mockResolvedValue(null as never);
    expect(await f.service.authenticate({ email: 'missing@example.com' })).toHaveProperty(
      'challengeId',
    );
    expect(f.provider.sendEmailOtp).not.toHaveBeenCalled();
  });
  it('rejects public administrative role selection', () => {
    expect(
      signupSchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        role: 'admin',
      }).success,
    ).toBe(false);
    // Selecting an existing role is not permission to register or authenticate it.
    expect(loginSchema.safeParse({ email: 'a@example.com', role: 'admin' }).success).toBe(true);
  });
});
