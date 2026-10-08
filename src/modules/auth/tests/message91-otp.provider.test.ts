import { describe, expect, it, vi } from 'vitest';
import {
  Message91OtpProvider,
  type Message91OtpConfig,
} from '../providers/message91-otp.provider.js';
import { FallbackOtpProvider } from '../providers/fallback-otp.provider.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import { selectOtpProvider } from '../providers/otp-provider-selection.js';
const config: Message91OtpConfig = {
  apiKey: 'fixture-key',
  templateId: 'fixture-template',
  baseUrl: 'https://control.msg91.com/api/v5',
  expiryMinutes: 10,
  timeoutMs: 1000,
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
describe('MSG91 SMS adapter and provider composition', () => {
  it('uses its v5 send contract, six-digit codes, auth header and country-code mobile', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ type: 'success', message: 'request-id' }));
    const provider = new Message91OtpProvider({ ...config, senderId: 'FIXTUR' }, request);
    const result = await provider.sendSmsOtp('+919999999999');
    const [url, options] = request.mock.calls[0]!;
    expect(String(url)).toContain('/api/v5/otp?');
    expect(new URL(String(url)).searchParams.get('mobile')).toBe('919999999999');
    expect(new URL(String(url)).searchParams.get('template_id')).toBe('fixture-template');
    expect(new URL(String(url)).searchParams.get('otp_length')).toBe('6');
    expect(new URL(String(url)).searchParams.has('authkey')).toBe(false);
    expect(options?.headers).toMatchObject({ authkey: 'fixture-key' });
    expect(options?.method).toBe('POST');
    expect(result).toMatchObject({ provider: 'message91', sessionToken: '919999999999' });
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
  });
  it('only accepts actual verification, rejects already-verified responses', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ type: 'success', message: 'OTP verified success' }))
      .mockResolvedValueOnce(response({ type: 'success', message: 'Mobile no. already verified' }));
    const provider = new Message91OtpProvider(config, request);
    expect(await provider.verifySmsOtp('919999999999', '123456')).toEqual({
      verified: true,
      attemptsRemaining: null,
    });
    await expect(provider.verifySmsOtp('919999999999', '123456')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_VERIFY_FAILED',
    });
    expect(String(request.mock.calls[0]![0])).toContain('/otp/verify?');
  });
  it.each(['Invalid OTP', 'OTP expired', 'OTP not match'])(
    'does not report success for %s',
    async (message) => {
      const provider = new Message91OtpProvider(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(response({ type: 'error', message })),
      );
      expect(await provider.verifySmsOtp('919999999999', '123456')).toEqual({
        verified: false,
        attemptsRemaining: null,
      });
    },
  );
  it('resends by SMS rather than default voice', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ type: 'success', message: 'otp_sent_successfully' }));
    await new Message91OtpProvider(config, request).resendSmsOtp('919999999999');
    expect(String(request.mock.calls[0]![0])).toContain(
      '/otp/retry?mobile=919999999999&retrytype=text',
    );
  });
  it.each([{}, { type: 'error', message: 'Unauthorized' }, null])(
    'rejects invalid/provider-failure send responses %j',
    async (value) => {
      await expect(
        new Message91OtpProvider(
          config,
          vi.fn<typeof fetch>().mockResolvedValue(response(value)),
        ).sendSmsOtp('+919999999999'),
      ).rejects.toMatchObject({ code: 'OTP_PROVIDER_SEND_FAILED' });
    },
  );
  it('does not expose network errors or secrets', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('fixture-key 123456 sensitive-url'));
    await expect(
      new Message91OtpProvider(config, request).sendSmsOtp('+919999999999'),
    ).rejects.toMatchObject({ message: 'SMS verification service is temporarily unavailable' });
  });
  it.each([
    { apiKey: '' },
    { templateId: '' },
    { baseUrl: 'http://unsafe.test/api/v5' },
    { baseUrl: 'https://user:password@unsafe.test/api/v5' },
  ])('fails configuration closed %j', (override) => {
    expect(() => new Message91OtpProvider({ ...config, ...override })).toThrow('MSG91 requires');
  });
  it('routes selected SMS without affecting email or outstanding SendMator sessions', async () => {
    const primary = {
      sendEmailOtp: vi
        .fn()
        .mockResolvedValue({ sessionId: 'id', sessionToken: 'email', expiresAt: '2030-01-01' }),
      verifySmsOtp: vi.fn().mockResolvedValue({ verified: true, attemptsRemaining: 4 }),
    } as unknown as OtpProvider;
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ type: 'success', message: 'request-id' }));
    const selected = selectOtpProvider(primary, undefined, vi.fn(), true, {
      name: 'message91',
      adapter: new Message91OtpProvider(config, request),
    });
    expect(selected).toBeInstanceOf(FallbackOtpProvider);
    expect((await selected.sendSmsOtp('+919999999999')).sessionToken).toBe(
      'message91:919999999999',
    );
    expect((await selected.sendEmailOtp('fixture@example.test')).sessionToken).toBe(
      'sendmator:email',
    );
    await selected.verifySmsOtp('sendmator:old-token', '123456');
    expect(primary.verifySmsOtp).toHaveBeenCalledWith('old-token', '123456');
    await expect(selected.verifySmsOtp('unknown:token', '123456')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SESSION_INVALID',
    });
  });
});
