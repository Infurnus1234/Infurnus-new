import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { env, envSchema } from '../../../config/env.js';
import { createConfiguredOtpProvider } from '../providers/otp-provider.factory.js';
import {
  GenericHttpOtpProvider,
  type HttpOtpProfile,
} from '../providers/generic-http-otp.provider.js';
import type { ResendOtpProvider } from '../providers/resend-otp.provider.js';

const profile = (id: string): HttpOtpProfile => ({
  id,
  timeoutMs: 500,
  operations: {
    send: {
      url: 'https://provider.example/send',
      method: 'POST',
      headers: { authorization: 'Bearer {{env:OTP_TEST_SECRET}}' },
      body: { to: '{{recipient}}', sender: '{{sender}}', template: '{{template}}' },
      success: [{ path: 'ok', equals: true }],
    },
    verify: {
      url: 'https://provider.example/verify',
      method: 'POST',
      body: { token: '{{sessionToken}}', code: '{{otp}}' },
      success: [{ path: 'verified', equals: true }],
      invalid: [{ path: 'verified', equals: false }],
    },
    resend: {
      url: 'https://provider.example/resend',
      method: 'GET',
      query: { session: '{{sessionToken}}' },
      success: [{ path: 'ok', equals: true }],
    },
  },
  variables: { sender: 'application', template: 'LOGIN_OTP' },
  response: {
    sessionTokenPath: 'token',
    sessionIdPath: 'id',
    ttlSeconds: 600,
    attemptsPath: 'attempts',
  },
});
const transport = () =>
  vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return new Response(
      JSON.stringify(
        url.pathname.endsWith('/verify')
          ? { verified: body.code === '123456', attempts: 3 }
          : { ok: true, token: 'opaque', id: 'fixture' },
      ),
    );
  });
const original = { ...env };
afterEach(() => {
  Object.assign(env, original);
  env.OTP_PROVIDER_CONFIG = original.OTP_PROVIDER_CONFIG;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('generic OTP engine and production configuration safety', () => {
  it('switches both channels through configuration only with identical consumers and retains original sessions', async () => {
    const request = transport();
    let selected = profile('configurationA');
    const provider = new GenericHttpOtpProvider(
      () => ({
        email: selected,
        sms: selected,
        retained: {
          email: { configurationA: profile('configurationA') },
          sms: { configurationA: profile('configurationA') },
        },
      }),
      undefined,
      request,
      { OTP_TEST_SECRET: 'fixture-secret' },
    );
    for (const id of ['configurationA', 'configurationB']) {
      selected = profile(id);
      for (const channel of ['email', 'sms'] as const) {
        const session =
          channel === 'email'
            ? await provider.sendEmailOtp('fixture@example.com')
            : await provider.sendSmsOtp('+919999999999');
        expect(session.sessionToken).toBe(`${id}:opaque`);
        const verify =
          channel === 'email'
            ? provider.verifyEmailOtp.bind(provider)
            : provider.verifySmsOtp.bind(provider);
        expect((await verify(session.sessionToken, '000000')).verified).toBe(false);
        expect((await verify(session.sessionToken, '123456')).verified).toBe(true);
        await (channel === 'email'
          ? provider.resendEmailOtp(session.sessionToken)
          : provider.resendSmsOtp(session.sessionToken));
      }
    }
    expect((await provider.verifySmsOtp('configurationA:opaque', '123456')).verified).toBe(true);
    const [, options] = request.mock.calls[0]!;
    expect(options?.headers).toMatchObject({ authorization: 'Bearer fixture-secret' });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      sender: 'application',
      template: 'LOGIN_OTP',
    });
  });
  it('constructs production factory with no local file assumptions and fails incomplete active operations safely', async () => {
    env.NODE_ENV = 'production';
    env.RESEND_API_KEY = undefined;
    env.OTP_PROVIDER_CONFIG = undefined;
    await expect(
      createConfiguredOtpProvider({} as Pool).sendSmsOtp('+919999999999'),
    ).rejects.toMatchObject({ code: 'OTP_PROVIDER_NOT_CONFIGURED' });
    env.OTP_PROVIDER_CONFIG = '{}';
    expect(
      envSchema.safeParse({
        ...env,
        AUTH_REFRESH_COOKIE_SECURE: true,
        AUTH_CSRF_COOKIE_SECURE: true,
        CLOUDINARY_CLOUD_NAME: 'fixture-cloud',
        CLOUDINARY_API_KEY: 'fixture-cloud-key',
        CLOUDINARY_API_SECRET: 'fixture-cloud-secret',
        MAP_DRIVER_RADII_METERS: env.MAP_DRIVER_RADII_METERS.join(','),
      }).success,
    ).toBe(true);
    const provider = createConfiguredOtpProvider({} as Pool);
    await expect(provider.sendSmsOtp('+919999999999')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_NOT_CONFIGURED',
      statusCode: 503,
    });
    env.OTP_PROVIDER_CONFIG = '{malformed';
    await expect(provider.sendEmailOtp('fixture@example.com')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_CONFIGURATION_INVALID',
    });
  });
  it('starts with valid active generic configuration while unused generic profiles are absent/ignored', async () => {
    env.NODE_ENV = 'production';
    env.RESEND_API_KEY = undefined;
    env.OTP_PROVIDER_CONFIG = JSON.stringify({
      email: profile('active'),
      sms: profile('active'),
      retained: { sms: { unused: { malformed: true } } },
    });
    vi.stubEnv('OTP_TEST_SECRET', 'fixture-secret');
    vi.stubGlobal('fetch', transport());
    const provider = createConfiguredOtpProvider({} as Pool);
    expect((await provider.sendEmailOtp('fixture@example.com')).provider).toBe('active');
    expect((await provider.sendSmsOtp('+919999999999')).provider).toBe('active');
  });
  it('rejects missing secrets, unsafe endpoints/mappings and unaccepted responses without false success', async () => {
    const request = transport();
    const active = profile('active');
    const provider = new GenericHttpOtpProvider(() => ({ sms: active }), undefined, request, {});
    await expect(provider.sendSmsOtp('+919999999999')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_NOT_CONFIGURED',
    });
    expect(request).not.toHaveBeenCalled();
    active.operations.send.headers = {};
    active.operations.send.url = 'http://provider.example/send';
    await expect(provider.sendSmsOtp('+919999999999')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_CONFIGURATION_INVALID',
    });
    active.operations.send.url = 'https://provider.example/send';
    active.operations.send.success = [{ path: '__proto__.ok', equals: true }];
    await expect(provider.sendSmsOtp('+919999999999')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SEND_FAILED',
    });
    request.mockResolvedValueOnce(new Response(JSON.stringify({ verified: true, attempts: null })));
    await expect(provider.verifySmsOtp('active:opaque', '123456')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_INVALID_RESPONSE',
    });
  });
  it('keeps application alive during outages and respects exactly existing email fallback triggers', async () => {
    const fallback = {
      sendEmailOtp: vi.fn(async () => ({
        sessionId: 'fallback',
        sessionToken: 'local',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      })),
      verifyEmailOtp: vi.fn(async () => ({ verified: true, attemptsRemaining: 3 })),
      resendEmailOtp: vi.fn(async () => ({
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      })),
    } as unknown as ResendOtpProvider;
    const active = profile('active');
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('credential-looking-private-error'));
    const provider = new GenericHttpOtpProvider(
      () => ({ email: active, sms: active }),
      fallback,
      request,
      { OTP_TEST_SECRET: 'fixture' },
    );
    const session = await provider.sendEmailOtp('fixture@example.com');
    expect(session.sessionToken).toBe('resend:local');
    await provider.verifyEmailOtp(session.sessionToken, '123456');
    await provider.resendEmailOtp(session.sessionToken);
    await expect(provider.sendSmsOtp('+919999999999')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SEND_FAILED',
    });
    request.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, token: 'opaque', id: 'fixture' })),
    );
    expect((await provider.sendSmsOtp('+919999999999')).provider).toBe('active');
    const invalid = new GenericHttpOtpProvider(() => ({ email: active }), fallback, request, {});
    await expect(invalid.sendEmailOtp('fixture@example.com')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_NOT_CONFIGURED',
    });
    expect(fallback.sendEmailOtp).toHaveBeenCalledTimes(1);
  });
  it('supports the existing missing-primary email fallback policy only when explicitly configured', async () => {
    const fallback = {
      sendEmailOtp: vi.fn(async () => ({
        sessionId: 'fallback',
        sessionToken: 'local',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      })),
    } as unknown as ResendOtpProvider;
    const allowed = new GenericHttpOtpProvider(() => ({ emailFallbackOnMissing: true }), fallback);
    expect((await allowed.sendEmailOtp('fixture@example.com')).provider).toBe('resend');
    await expect(
      new GenericHttpOtpProvider(() => ({}), fallback).sendEmailOtp('fixture@example.com'),
    ).rejects.toMatchObject({ code: 'OTP_PROVIDER_NOT_CONFIGURED' });
  });
  it('maps nested environment variables and configured rejection fields without forwarding private errors', async () => {
    const active = profile('active');
    active.variables = { sender: '{{env:OTP_SENDER}}', template: 'LOGIN_OTP' };
    active.operations.send.rejected = [{ path: 'error.code', equals: 'rejected' }];
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'rejected', message: 'private-fixture-secret' },
            ok: true,
            token: 'opaque',
            id: 'fixture',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, token: 'opaque', id: 'fixture' })),
      );
    const provider = new GenericHttpOtpProvider(() => ({ sms: active }), undefined, request, {
      OTP_TEST_SECRET: 'fixture',
      OTP_SENDER: 'application',
    });
    await expect(provider.sendSmsOtp('+919999999999')).rejects.toMatchObject({
      code: 'OTP_PROVIDER_SEND_FAILED',
      message: 'Verification service is temporarily unavailable',
    });
    await provider.sendSmsOtp('+919999999999');
    expect(JSON.parse(String(request.mock.calls[1]![1]?.body)).sender).toBe('application');
  });
});
