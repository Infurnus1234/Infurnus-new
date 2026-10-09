import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GenericHttpOtpProvider,
  type HttpOtpProfile,
} from '../providers/generic-http-otp.provider.js';

const profile: HttpOtpProfile = {
  id: 'generic',
  operations: {
    send: {
      url: 'https://otp.example/send',
      method: 'POST',
      headers: { authorization: 'Bearer {{env:OTP_API_KEY}}' },
      body: { to: '{{recipient}}' },
      success: [{ path: 'accepted', equals: true }],
    },
    verify: {
      url: 'https://otp.example/verify',
      method: 'POST',
      headers: { authorization: 'Bearer {{env:OTP_API_KEY}}' },
      body: { token: '{{sessionToken}}', otp: '{{otp}}' },
      success: [{ path: 'verified', equals: true }],
    },
    resend: {
      url: 'https://otp.example/resend',
      method: 'POST',
      headers: { authorization: 'Bearer {{env:OTP_API_KEY}}' },
      body: { token: '{{sessionToken}}' },
      success: [{ path: 'accepted', equals: true }],
    },
  },
  response: { sessionTokenPath: 'token', ttlSeconds: 600 },
};
afterEach(() => vi.unstubAllEnvs());
describe('generic API-key binding', () => {
  it('consumes runtime OTP_API_KEY exactly for send, verify and resend without vendor names', async () => {
    const key = 'fixture-key-with-Case-and-symbols_+/=';
    vi.stubEnv('OTP_API_KEY', key);
    const request = vi.fn<typeof fetch>(async (input, options) => {
      expect((options?.headers as Record<string, string>).authorization === `Bearer ${key}`).toBe(
        true,
      );
      return new Response(
        JSON.stringify(
          String(input).endsWith('/verify')
            ? { verified: true }
            : { accepted: true, token: 'fixture-token' },
        ),
      );
    });
    const provider = new GenericHttpOtpProvider(
      () => ({ email: profile, sms: profile }),
      undefined,
      request,
    );
    const session = await provider.sendEmailOtp('fixture@example.com');
    expect((await provider.verifyEmailOtp(session.sessionToken, '123456')).verified).toBe(true);
    await provider.resendEmailOtp(session.sessionToken);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not trim or transform resolved secret data', async () => {
    const key = '  fixture-key  ';
    const request = vi.fn<typeof fetch>(async (_input, options) => {
      expect((options?.headers as Record<string, string>).authorization === `Bearer ${key}`).toBe(
        true,
      );
      return new Response(JSON.stringify({ accepted: true, token: 'fixture-token' }));
    });
    await new GenericHttpOtpProvider(() => ({ sms: profile }), undefined, request, {
      OTP_API_KEY: key,
    }).sendSmsOtp('+919999999999');
  });
  it.each([undefined, ''])(
    'rejects absent/empty active keys before requesting delivery',
    async (key) => {
      const request = vi.fn<typeof fetch>();
      const provider = new GenericHttpOtpProvider(() => ({ sms: profile }), undefined, request, {
        OTP_API_KEY: key,
      });
      await expect(provider.sendSmsOtp('+919999999999')).rejects.toMatchObject({
        code: 'OTP_PROVIDER_NOT_CONFIGURED',
        statusCode: 503,
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
});
