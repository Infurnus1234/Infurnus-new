import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginVerificationService } from '../services/login-verification.service.js';
import type { AuthUserRepository } from '../repositories/auth-user.repository.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import type { LoginChallengeProviderSession } from '../types/login-challenge.js';

const decryptSecretMock = vi.hoisted(() => vi.fn());

vi.mock('../../../common/crypto/encryption.js', () => ({
  decryptSecret: decryptSecretMock,
}));

function createProviderSession(
  overrides: Partial<LoginChallengeProviderSession> = {},
): LoginChallengeProviderSession {
  const now = Date.now();

  return {
    id: 'challenge-id',
    userId: 'user-id',
    otpProvider: 'sendmator',
    otpChannel: 'sms',
    providerSessionId: 'provider-session-id',
    encryptedProviderSessionToken: 'encrypted-provider-token',
    providerExpiresAt: new Date(now + 10 * 60 * 1000),
    expiresAt: new Date(now + 10 * 60 * 1000),
    verifiedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function createDependencies() {
  const loginChallengeRepository = {
    getProviderSession: vi.fn(),
    consume: vi.fn(),
  } as unknown as LoginChallengeRepository;

  const authUserRepository = {
    findIdentityById: vi.fn(),
  } as unknown as AuthUserRepository;

  const otpProvider = {
    verifySmsOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
  } as unknown as OtpProvider;

  return {
    loginChallengeRepository,
    authUserRepository,
    otpProvider,
  };
}

describe('LoginVerificationService', () => {
  let service: LoginVerificationService;
  let loginChallengeRepository: LoginChallengeRepository;
  let authUserRepository: AuthUserRepository;
  let otpProvider: OtpProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    const dependencies = createDependencies();

    loginChallengeRepository = dependencies.loginChallengeRepository;

    authUserRepository = dependencies.authUserRepository;

    otpProvider = dependencies.otpProvider;

    service = new LoginVerificationService(
      loginChallengeRepository,
      authUserRepository,
      otpProvider,
    );

    decryptSecretMock.mockReturnValue('provider-session-token');
  });

  it('rejects an empty challenge id', async () => {
    await expect(service.verify('', '123456')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_CHALLENGE',
      statusCode: 400,
    });

    expect(loginChallengeRepository.getProviderSession).not.toHaveBeenCalled();
  });

  it('rejects an OTP that is not exactly six digits', async () => {
    await expect(service.verify('challenge-id', '12345')).rejects.toMatchObject({
      code: 'INVALID_OTP',
      statusCode: 400,
    });

    await expect(service.verify('challenge-id', '1234567')).rejects.toMatchObject({
      code: 'INVALID_OTP',
      statusCode: 400,
    });

    await expect(service.verify('challenge-id', 'abcdef')).rejects.toMatchObject({
      code: 'INVALID_OTP',
      statusCode: 400,
    });

    expect(loginChallengeRepository.getProviderSession).not.toHaveBeenCalled();
  });

  it('rejects a missing login challenge', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(null);

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_CHALLENGE',
      statusCode: 400,
    });

    expect(otpProvider.verifySmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an already consumed challenge', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        consumedAt: new Date(),
      }),
    );

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'LOGIN_CHALLENGE_ALREADY_CONSUMED',
      statusCode: 400,
    });

    expect(otpProvider.verifySmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an already verified challenge', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        verifiedAt: new Date(),
      }),
    );

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'LOGIN_CHALLENGE_ALREADY_VERIFIED',
      statusCode: 400,
    });

    expect(otpProvider.verifySmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an expired challenge before calling the OTP provider', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        expiresAt: new Date(Date.now() - 1000),
      }),
    );

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
      statusCode: 400,
    });

    expect(otpProvider.verifySmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects when the encrypted provider session token cannot be decrypted', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    decryptSecretMock.mockImplementation(() => {
      throw new Error('decryption failed');
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SESSION_INVALID',
      statusCode: 500,
    });

    expect(otpProvider.verifySmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.verifyEmailOtp).not.toHaveBeenCalled();

    expect(loginChallengeRepository.consume).not.toHaveBeenCalled();
  });

  it('rejects an invalid OTP when attempts remain', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: false,
      attemptsRemaining: 2,
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'INVALID_OTP',
      statusCode: 400,
    });

    expect(otpProvider.verifySmsOtp).toHaveBeenCalledWith('provider-session-token', '123456');

    expect(loginChallengeRepository.consume).not.toHaveBeenCalled();

    expect(authUserRepository.findIdentityById).not.toHaveBeenCalled();
  });

  it('rejects with 429 when OTP attempts are exhausted', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: false,
      attemptsRemaining: 0,
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'OTP_ATTEMPTS_EXCEEDED',
      statusCode: 429,
    });

    expect(loginChallengeRepository.consume).not.toHaveBeenCalled();

    expect(authUserRepository.findIdentityById).not.toHaveBeenCalled();
  });

  it('rejects when the challenge cannot be consumed after successful provider verification', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'already_consumed',
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'LOGIN_CHALLENGE_ALREADY_CONSUMED',
      statusCode: 400,
    });

    expect(authUserRepository.findIdentityById).not.toHaveBeenCalled();
  });

  it('rejects when the challenge is not found during consume', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'not_found',
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_CHALLENGE',
      statusCode: 400,
    });

    expect(authUserRepository.findIdentityById).not.toHaveBeenCalled();
  });

  it('rejects when the challenge expires during consume', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'expired',
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
      statusCode: 400,
    });

    expect(authUserRepository.findIdentityById).not.toHaveBeenCalled();
  });

  it('rejects when consume succeeds without returning user identity', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'consumed',
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'LOGIN_VERIFICATION_FAILED',
      statusCode: 500,
    });

    expect(authUserRepository.findIdentityById).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'consumed',
      userId: 'user-id',
      role: 'customer',
    });

    vi.mocked(authUserRepository.findIdentityById).mockResolvedValue(null);

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      statusCode: 401,
    });

    expect(authUserRepository.findIdentityById).toHaveBeenCalledWith('user-id');
  });

  it.each(['suspended', 'banned'] as const)(
    'rejects a %s user after successful OTP verification',
    async (status) => {
      vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
        createProviderSession(),
      );

      vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
        verified: true,
        attemptsRemaining: 5,
      });

      vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
        status: 'consumed',
        userId: 'user-id',
        role: 'customer',
      });

      vi.mocked(authUserRepository.findIdentityById).mockResolvedValue({
        id: 'user-id',
        role: 'customer',
        status,
      });

      await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
        code: 'ACCOUNT_NOT_ACTIVE',
        statusCode: 401,
      });

      expect(authUserRepository.findIdentityById).toHaveBeenCalledWith('user-id');
    },
  );

  it('returns the current user identity for an active user', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'consumed',
      userId: 'user-id',
      role: 'customer',
    });

    vi.mocked(authUserRepository.findIdentityById).mockResolvedValue({
      id: 'user-id',
      role: 'customer',
      status: 'active',
    });

    const result = await service.verify('challenge-id', '123456');

    expect(result).toEqual({
      userId: 'user-id',
      role: 'customer',
    });

    expect(loginChallengeRepository.getProviderSession).toHaveBeenCalledWith('challenge-id');

    expect(decryptSecretMock).toHaveBeenCalledWith('encrypted-provider-token');

    expect(otpProvider.verifySmsOtp).toHaveBeenCalledWith('provider-session-token', '123456');

    expect(loginChallengeRepository.consume).toHaveBeenCalledWith('challenge-id');

    expect(authUserRepository.findIdentityById).toHaveBeenCalledWith('user-id');
  });

  it('verifies an email OTP when the challenge channel is email', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        otpChannel: 'email',
      }),
    );

    vi.mocked(otpProvider.verifyEmailOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'consumed',
      userId: 'user-id',
      role: 'customer',
    });

    vi.mocked(authUserRepository.findIdentityById).mockResolvedValue({
      id: 'user-id',
      role: 'customer',
      status: 'active',
    });

    const result = await service.verify('challenge-id', '123456');

    expect(result).toEqual({
      userId: 'user-id',
      role: 'customer',
    });

    expect(otpProvider.verifyEmailOtp).toHaveBeenCalledWith('provider-session-token', '123456');

    expect(otpProvider.verifySmsOtp).not.toHaveBeenCalled();

    expect(loginChallengeRepository.consume).toHaveBeenCalledWith('challenge-id');

    expect(authUserRepository.findIdentityById).toHaveBeenCalledWith('user-id');
  });

  it('uses the current user role instead of trusting the challenge role', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'consumed',
      userId: 'user-id',
      role: 'driver',
    });

    vi.mocked(authUserRepository.findIdentityById).mockResolvedValue({
      id: 'user-id',
      role: 'customer',
      status: 'active',
    });

    const result = await service.verify('challenge-id', '123456');

    expect(result).toEqual({
      userId: 'user-id',
      role: 'customer',
    });
  });

  it('does not expose the provider session token in the result', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: true,
      attemptsRemaining: 5,
    });

    vi.mocked(loginChallengeRepository.consume).mockResolvedValue({
      status: 'consumed',
      userId: 'user-id',
      role: 'customer',
    });

    vi.mocked(authUserRepository.findIdentityById).mockResolvedValue({
      id: 'user-id',
      role: 'customer',
      status: 'active',
    });

    const result = await service.verify('challenge-id', '123456');

    expect(result).not.toHaveProperty('providerSessionToken');

    expect(result).not.toHaveProperty('encryptedProviderSessionToken');

    expect(result).not.toHaveProperty('otp');

    expect(JSON.stringify(result)).not.toContain('provider-session-token');
  });

  it('does not call the user repository when provider verification fails', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(otpProvider.verifySmsOtp).mockResolvedValue({
      verified: false,
      attemptsRemaining: 1,
    });

    await expect(service.verify('challenge-id', '123456')).rejects.toMatchObject({
      code: 'INVALID_OTP',
      statusCode: 400,
    });

    expect(authUserRepository.findIdentityById).not.toHaveBeenCalled();

    expect(loginChallengeRepository.consume).not.toHaveBeenCalled();
  });
});
