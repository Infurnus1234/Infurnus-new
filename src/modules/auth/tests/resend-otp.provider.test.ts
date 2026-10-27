import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../config/env.js';
import { ResendOtpProvider } from '../providers/resend-otp.provider.js';
import type { ResendOtpSessionRepository } from '../types/resend-otp.js';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));
const originalKey = env.RESEND_API_KEY;
beforeEach(() => {
  env.RESEND_API_KEY = 'fixture-key';
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  env.RESEND_API_KEY = originalKey;
  vi.restoreAllMocks();
  vi.useRealTimers();
  send.mockReset();
});

function repository() {
  return {
    create: vi.fn().mockResolvedValue({ id: 'fixture-session' }),
    verify: vi.fn().mockResolvedValue({ status: 'invalid', attemptsRemaining: 3 }),
    findBySessionTokenHash: vi.fn(),
    resend: vi.fn(),
    consume: vi.fn(),
  } satisfies ResendOtpSessionRepository;
}

describe('Resend acceptance and fail-closed challenge creation', () => {
  it('requires credentials', () => {
    env.RESEND_API_KEY = undefined;
    expect(() => new ResendOtpProvider(repository())).toThrow('Resend API key is not configured');
  });
  it('normalizes email and persists only protected codes after provider acceptance', async () => {
    send.mockResolvedValue({ data: { id: 'email-message-id' }, error: null });
    const repo = repository();
    const result = await new ResendOtpProvider(repo).sendEmailOtp(
      ' Fixture@Example.COM ',
      'request-id',
    );
    expect(send.mock.calls[0]![0].to).toBe('fixture@example.com');
    expect(repo.create.mock.calls[0]![0]).toMatchObject({ email: 'fixture@example.com' });
    const stored = repo.create.mock.calls[0]![0];
    expect(stored.otpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.sessionTokenHash).not.toBe(result.sessionToken);
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('email-message-id');
    expect(logs).toContain('unconfirmed');
    expect(logs).not.toContain('fixture@example.com');
    expect(logs).not.toContain(result.sessionToken);
  });
  it.each([
    { error: { name: 'validation_error', message: 'private recipient' }, data: null },
    { error: null, data: {} },
  ])('does not persist a challenge for rejection/malformed acceptance', async (response) => {
    send.mockResolvedValue(response);
    const repo = repository();
    await expect(
      new ResendOtpProvider(repo).sendEmailOtp('fixture@example.com'),
    ).rejects.toMatchObject({ code: 'OTP_PROVIDER_SEND_FAILED' });
    expect(repo.create).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('private recipient');
  });
  it('times out without persisting a challenge or reporting delivery', async () => {
    vi.useFakeTimers();
    send.mockImplementation(() => new Promise(() => {}));
    const repo = repository();
    const result = expect(
      new ResendOtpProvider(repo, 10).sendEmailOtp('fixture@example.com'),
    ).rejects.toMatchObject({ code: 'OTP_PROVIDER_SEND_FAILED' });
    await vi.advanceTimersByTimeAsync(11);
    await result;
    expect(repo.create).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain('timeout');
  });
  it('rejects an incorrect code without claiming verification', async () => {
    const result = await new ResendOtpProvider(repository()).verifyEmailOtp(
      'private-token',
      '000000',
    );
    expect(result.verified).toBe(false);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain('invalid');
  });
});
