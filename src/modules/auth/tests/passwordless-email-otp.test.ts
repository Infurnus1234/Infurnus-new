import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const send = vi.hoisted(() =>
  vi.fn(async (_message: { text: string }) => ({ data: { id: 'delivery-id' } })),
);
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock('../../../config/env.js', () => ({
  env: {
    RESEND_API_KEY: 'fixture',
    RESEND_FROM_EMAIL: 'fixture@example.com',
    AUTH_OTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  },
}));
import { ResendOtpProvider } from '../providers/resend-otp.provider.js';
describe('protected passwordless email OTP storage', () => {
  it('keys verification codes to the secret and session while accepting outstanding legacy codes', async () => {
    const repository = {
      create: vi.fn(async () => ({ id: 'session-id' })),
      verify: vi.fn(async () => ({ status: 'verified' as const, attemptsRemaining: 5 })),
      findBySessionTokenHash: vi.fn(),
      resend: vi.fn(),
      consume: vi.fn(),
    };
    const provider = new ResendOtpProvider(repository);
    const session = await provider.sendEmailOtp('fixture@example.com');
    const code = send.mock.calls[0]![0].text.match(/OTP is (\d{6})/)![1]!;
    const legacyHash = createHash('sha256').update(code).digest('hex');
    const stored = repository.create.mock.calls[0] as unknown as [{ otpHash: string }];
    expect(stored[0].otpHash).not.toBe(legacyHash);
    expect(stored[0].otpHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(provider.verifyEmailOtp(session.sessionToken, code)).resolves.toMatchObject({
      verified: true,
    });
    expect(repository.verify).toHaveBeenCalledWith(
      expect.any(String),
      stored[0].otpHash,
      legacyHash,
    );
  });
  it('sanitizes network errors and bounds provider response time', async () => {
    const repository = { create: vi.fn() };
    const provider = new ResendOtpProvider(repository as never, 5);
    send.mockRejectedValueOnce(new Error('private error with credentials'));
    await expect(provider.sendEmailOtp('fixture@example.com')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SEND_FAILED',
      statusCode: 502,
    });
    send.mockReturnValueOnce(new Promise(() => {}));
    await expect(provider.sendEmailOtp('fixture@example.com')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SEND_FAILED',
      statusCode: 502,
    });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('rejects exhausted resend sessions without delivery', async () => {
    const repository = {
      findBySessionTokenHash: vi.fn(async () => ({
        email: 'fixture@example.com',
        expiresAt: new Date(Date.now() + 60000),
        lastSentAt: new Date(Date.now() - 120000),
        consumedAt: null,
        attempts: 10,
        maxAttempts: 10,
      })),
    };
    const sent = send.mock.calls.length;
    await expect(
      new ResendOtpProvider(repository as never).resendEmailOtp('session'),
    ).rejects.toMatchObject({ code: 'OTP_ATTEMPTS_EXCEEDED', statusCode: 429 });
    expect(send.mock.calls.length).toBe(sent);
  });
  it('rejects consumed, expired and cooldown-blocked resend sessions without delivery', async () => {
    const session = {
      email: 'fixture@example.com',
      expiresAt: new Date(Date.now() + 60000),
      lastSentAt: new Date(),
      consumedAt: new Date(),
    };
    const repository = { findBySessionTokenHash: vi.fn(async () => session) };
    const provider = new ResendOtpProvider(repository as never);
    const sent = send.mock.calls.length;
    await expect(provider.resendEmailOtp('session')).rejects.toMatchObject({
      code: 'OTP_ALREADY_VERIFIED',
    });
    Object.assign(session, { consumedAt: null, expiresAt: new Date(Date.now() - 1000) });
    await expect(provider.resendEmailOtp('session')).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
    Object.assign(session, { expiresAt: new Date(Date.now() + 60000) });
    await expect(provider.resendEmailOtp('session')).rejects.toMatchObject({
      code: 'OTP_RESEND_COOLDOWN',
    });
    expect(send.mock.calls.length).toBe(sent);
  });
});
