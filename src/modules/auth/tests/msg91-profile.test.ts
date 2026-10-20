import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenericHttpOtpProvider } from '../providers/generic-http-otp.provider.js';
import { createMsg91Profile } from '../providers/msg91-profile.js';

const secret = { MSG91_AUTH_KEY: 'test-only-key', MSG91_TEMPLATE_ID: 'test-only-template' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture() {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ type: 'success', request_id: 'request-id' }));
  const provider = new GenericHttpOtpProvider(
    () => ({ sms: createMsg91Profile() }),
    undefined,
    request,
    secret,
  );
  return { request, provider };
}
afterEach(() => vi.useRealTimers());
describe('MSG91 documented SendOTP v5 profile', () => {
  it('sends six-digit provider-generated OTP, verifies by mobile and retries by text without extending expiry', async () => {
    const { request, provider } = fixture();
    const session = await provider.sendSmsOtp('+91 98765 43210');
    const [target, options] = request.mock.calls[0]!;
    const url = new URL(String(target));
    expect(url.origin + url.pathname).toBe('https://control.msg91.com/api/v5/otp');
    expect(url.searchParams.get('mobile')).toBe('919876543210');
    expect(url.searchParams.get('template_id')).toBe(secret.MSG91_TEMPLATE_ID);
    expect(url.searchParams.get('otp_length')).toBe('6');
    expect(url.searchParams.get('otp_expiry')).toBe('5');
    expect(url.searchParams.has('otp')).toBe(false);
    expect(options).toMatchObject({
      method: 'POST',
      headers: { authkey: secret.MSG91_AUTH_KEY },
      body: '{}',
    });
    request.mockResolvedValueOnce(response({ type: 'success', message: 'OTP verified success' }));
    expect(await provider.verifySmsOtp(session.sessionToken, '123456')).toEqual({
      verified: true,
      attemptsRemaining: null,
    });
    const verify = new URL(String(request.mock.calls[1]![0]));
    expect(verify.pathname).toBe('/api/v5/otp/verify');
    expect(verify.searchParams.get('mobile')).toBe('919876543210');
    expect(verify.searchParams.get('otp')).toBe('123456');
    expect(request.mock.calls[1]![1]?.method).toBe('GET');
    request.mockResolvedValueOnce(
      response({ type: 'success', message: 'retry send successfully' }),
    );
    expect((await provider.resendSmsOtp(session.sessionToken)).expiresAt).toBe(session.expiresAt);
    const retry = new URL(String(request.mock.calls[2]![0]));
    expect(retry.pathname).toBe('/api/v5/otp/retry');
    expect(retry.searchParams.get('retrytype')).toBe('text');
    expect(retry.searchParams.get('authkey')).toBe(secret.MSG91_AUTH_KEY);
  });
  it.each(['OTP not match', 'OTP expired'])('does not authenticate %s', async (message) => {
    const { request, provider } = fixture();
    const session = await provider.sendSmsOtp('+919876543210');
    request.mockResolvedValue(response({ type: 'error', message }));
    expect((await provider.verifySmsOtp(session.sessionToken, '123456')).verified).toBe(false);
  });
  it.each([401, 403, 429, 500, 503])(
    'sanitizes HTTP %s without leaking provider data',
    async (status) => {
      const { request, provider } = fixture();
      request.mockResolvedValue(response({ message: 'private-provider-detail' }, status));
      await expect(provider.sendSmsOtp('+919876543210')).rejects.toMatchObject({
        code: 'OTP_PROVIDER_SEND_FAILED',
        statusCode: 502,
      });
    },
  );
  it.each([
    'Invalid authkey',
    'The provided flow ID or template ID is invalid.',
    'Insufficient balance',
    'DLT template not approved',
  ])('rejects a provider business error: %s', async (message) => {
    const { request, provider } = fixture();
    request.mockResolvedValue(response({ type: 'error', message }));
    await expect(provider.sendSmsOtp('+919876543210')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SEND_FAILED',
    });
  });
  it('never mistakes a successful send response for successful verification', async () => {
    const { provider } = fixture();
    const session = await provider.sendSmsOtp('+919876543210');
    await expect(provider.verifySmsOtp(session.sessionToken, '123456')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_VERIFY_FAILED',
    });
  });
  it('rejects malformed recipients and missing credentials before sending', async () => {
    const { request, provider } = fixture();
    await expect(provider.sendSmsOtp('not-a-phone')).rejects.toMatchObject({
      code: 'INVALID_PHONE',
    });
    const missing = new GenericHttpOtpProvider(
      () => ({ sms: createMsg91Profile() }),
      undefined,
      request,
      {},
    );
    await expect(missing.sendSmsOtp('+919876543210')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_NOT_CONFIGURED',
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('bounds request time and sanitizes network errors', async () => {
    const { request, provider } = fixture();
    request.mockImplementation(async (_url, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      throw new Error('private timeout');
    });
    await expect(provider.sendSmsOtp('+919876543210')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SEND_FAILED',
    });
  });
  it('rejects expired sessions before verify or resend, even when the provider would accept', async () => {
    const { request, provider } = fixture();
    vi.useFakeTimers();
    const session = await provider.sendSmsOtp('+919876543210');
    vi.advanceTimersByTime(300001);
    await expect(provider.verifySmsOtp(session.sessionToken, '123456')).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
    await expect(provider.resendSmsOtp(session.sessionToken)).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
