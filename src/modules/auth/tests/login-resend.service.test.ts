import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginResendService } from '../services/login-resend.service.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import type {
  LoginChallengeProviderSession,
  LoginChallengeResendClaim,
} from '../types/login-challenge.js';

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

function createResendClaim(
  overrides: Partial<LoginChallengeResendClaim> = {},
): LoginChallengeResendClaim {
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
    lastOtpSentAt: new Date(),
    ...overrides,
  };
}

function createDependencies() {
  const loginChallengeRepository = {
    getProviderSession: vi.fn(),
    claimResend: vi.fn(),
    updateProviderExpiry: vi.fn(),
  } as unknown as LoginChallengeRepository;

  const otpProvider = {
    resendSmsOtp: vi.fn(),
    resendEmailOtp: vi.fn(),
  } as unknown as OtpProvider;

  return {
    loginChallengeRepository,
    otpProvider,
  };
}

const decryptSecretMock = vi.hoisted(() => vi.fn());

vi.mock('../../../common/crypto/encryption.js', () => ({
  decryptSecret: decryptSecretMock,
}));

describe('LoginResendService', () => {
  const cooldownSeconds = 60;

  let service: LoginResendService;
  let loginChallengeRepository: LoginChallengeRepository;
  let otpProvider: OtpProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    const dependencies = createDependencies();

    loginChallengeRepository = dependencies.loginChallengeRepository;

    otpProvider = dependencies.otpProvider;

    service = new LoginResendService(loginChallengeRepository, otpProvider, cooldownSeconds);

    decryptSecretMock.mockReturnValue('provider-session-token');
  });

  it('rejects an empty challenge id', async () => {
    await expect(service.resend('')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_CHALLENGE',
      statusCode: 400,
    });

    expect(loginChallengeRepository.getProviderSession).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only challenge id', async () => {
    await expect(service.resend('   ')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_CHALLENGE',
      statusCode: 400,
    });

    expect(loginChallengeRepository.getProviderSession).not.toHaveBeenCalled();
  });

  it('rejects invalid cooldown configuration', async () => {
    const invalidService = new LoginResendService(loginChallengeRepository, otpProvider, -1);

    await expect(invalidService.resend('challenge-id')).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
      statusCode: 500,
    });

    expect(loginChallengeRepository.getProviderSession).not.toHaveBeenCalled();
  });

  it('rejects a missing login challenge', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(null);

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_CHALLENGE',
      statusCode: 400,
    });

    expect(loginChallengeRepository.claimResend).not.toHaveBeenCalled();

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an already consumed challenge', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        consumedAt: new Date(),
      }),
    );

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'LOGIN_CHALLENGE_ALREADY_CONSUMED',
      statusCode: 400,
    });

    expect(loginChallengeRepository.claimResend).not.toHaveBeenCalled();

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an already verified challenge', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        verifiedAt: new Date(),
      }),
    );

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'LOGIN_CHALLENGE_ALREADY_VERIFIED',
      statusCode: 400,
    });

    expect(loginChallengeRepository.claimResend).not.toHaveBeenCalled();

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an expired local challenge', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        expiresAt: new Date(Date.now() - 1000),
      }),
    );

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
      statusCode: 400,
    });

    expect(loginChallengeRepository.claimResend).not.toHaveBeenCalled();

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an expired provider session', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        providerExpiresAt: new Date(Date.now() - 1000),
      }),
    );

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
      statusCode: 400,
    });

    expect(loginChallengeRepository.claimResend).not.toHaveBeenCalled();

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects when the atomic resend cooldown claim fails', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(null);

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_RESEND_RATE_LIMITED',
      statusCode: 429,
    });

    expect(loginChallengeRepository.claimResend).toHaveBeenCalledWith(
      'challenge-id',
      cooldownSeconds,
    );

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();
  });

  it('decrypts the provider session token before resend', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    vi.mocked(otpProvider.resendSmsOtp).mockResolvedValue({
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    vi.mocked(loginChallengeRepository.updateProviderExpiry).mockResolvedValue(true);

    await service.resend('challenge-id');

    expect(decryptSecretMock).toHaveBeenCalledWith('encrypted-provider-token');

    expect(otpProvider.resendSmsOtp).toHaveBeenCalledWith('provider-session-token');
  });

  it('rejects when the provider session token cannot be decrypted', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    decryptSecretMock.mockImplementation(() => {
      throw new Error('decryption failed');
    });

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SESSION_INVALID',
      statusCode: 500,
    });

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();

    expect(loginChallengeRepository.updateProviderExpiry).not.toHaveBeenCalled();
  });

  it('rejects an empty decrypted provider session token', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    decryptSecretMock.mockReturnValue('');

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SESSION_INVALID',
      statusCode: 500,
    });

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(otpProvider.resendEmailOtp).not.toHaveBeenCalled();

    expect(loginChallengeRepository.updateProviderExpiry).not.toHaveBeenCalled();
  });

  it('resends the OTP and updates the provider expiry', async () => {
    const providerExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(
      createResendClaim({
        providerExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
    );

    vi.mocked(otpProvider.resendSmsOtp).mockResolvedValue({
      expiresAt: providerExpiresAt.toISOString(),
    });

    vi.mocked(loginChallengeRepository.updateProviderExpiry).mockResolvedValue(true);

    const result = await service.resend('challenge-id');

    expect(result.expiresAt.getTime()).toBe(providerExpiresAt.getTime());

    expect(loginChallengeRepository.claimResend).toHaveBeenCalledWith(
      'challenge-id',
      cooldownSeconds,
    );

    expect(otpProvider.resendSmsOtp).toHaveBeenCalledWith('provider-session-token');

    expect(loginChallengeRepository.updateProviderExpiry).toHaveBeenCalledWith(
      'challenge-id',
      expect.any(Date),
    );

    const updatedExpiry = vi.mocked(loginChallengeRepository.updateProviderExpiry).mock
      .calls[0]?.[1];

    expect(updatedExpiry?.getTime()).toBe(providerExpiresAt.getTime());
  });

  it('resends an email OTP when the challenge channel is email', async () => {
    const providerExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession({
        otpChannel: 'email',
      }),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(
      createResendClaim({
        otpChannel: 'email',
      }),
    );

    vi.mocked(otpProvider.resendEmailOtp).mockResolvedValue({
      expiresAt: providerExpiresAt.toISOString(),
    });

    vi.mocked(loginChallengeRepository.updateProviderExpiry).mockResolvedValue(true);

    const result = await service.resend('challenge-id');

    expect(result.expiresAt.getTime()).toBe(providerExpiresAt.getTime());

    expect(otpProvider.resendEmailOtp).toHaveBeenCalledWith('provider-session-token');

    expect(otpProvider.resendSmsOtp).not.toHaveBeenCalled();

    expect(loginChallengeRepository.updateProviderExpiry).toHaveBeenCalledWith(
      'challenge-id',
      expect.any(Date),
    );
  });

  it('maps provider resend failures to a controlled error', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    vi.mocked(otpProvider.resendSmsOtp).mockRejectedValue(new Error('provider internal error'));

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_UNAVAILABLE',
      statusCode: 502,
    });

    expect(loginChallengeRepository.updateProviderExpiry).not.toHaveBeenCalled();
  });

  it('rejects an invalid provider expiry response', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    vi.mocked(otpProvider.resendSmsOtp).mockResolvedValue({
      expiresAt: 'not-a-valid-date',
    });

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_INVALID_RESPONSE',
      statusCode: 502,
    });

    expect(loginChallengeRepository.updateProviderExpiry).not.toHaveBeenCalled();
  });

  it('rejects an already expired provider response', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    vi.mocked(otpProvider.resendSmsOtp).mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_INVALID_RESPONSE',
      statusCode: 502,
    });

    expect(loginChallengeRepository.updateProviderExpiry).not.toHaveBeenCalled();
  });

  it('rejects when updating provider expiry returns false', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    vi.mocked(otpProvider.resendSmsOtp).mockResolvedValue({
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    vi.mocked(loginChallengeRepository.updateProviderExpiry).mockResolvedValue(false);

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'LOGIN_RESEND_UPDATE_FAILED',
      statusCode: 500,
    });
  });

  it('maps provider expiry update database failures to a controlled error', async () => {
    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(createResendClaim());

    vi.mocked(otpProvider.resendSmsOtp).mockResolvedValue({
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    vi.mocked(loginChallengeRepository.updateProviderExpiry).mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(service.resend('challenge-id')).rejects.toMatchObject({
      code: 'LOGIN_RESEND_UPDATE_FAILED',
      statusCode: 500,
    });
  });

  it('does not expose the provider session token', async () => {
    const providerExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    vi.mocked(loginChallengeRepository.getProviderSession).mockResolvedValue(
      createProviderSession(),
    );

    vi.mocked(loginChallengeRepository.claimResend).mockResolvedValue(
      createResendClaim({
        providerExpiresAt,
        expiresAt: providerExpiresAt,
      }),
    );

    vi.mocked(otpProvider.resendSmsOtp).mockResolvedValue({
      expiresAt: providerExpiresAt.toISOString(),
    });

    vi.mocked(loginChallengeRepository.updateProviderExpiry).mockResolvedValue(true);

    const result = await service.resend('challenge-id');

    expect(result).toEqual({
      expiresAt: expect.any(Date),
    });

    expect(result).not.toHaveProperty('providerSessionToken');

    expect(result).not.toHaveProperty('encryptedProviderSessionToken');

    expect(JSON.stringify(result)).not.toContain('provider-session-token');
  });
});
