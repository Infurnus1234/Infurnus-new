import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { env } from '../../../config/env.js';
import { createConfiguredOtpProvider } from '../providers/otp-provider.factory.js';

const original = {
  auth: env.MSG91_AUTH_KEY,
  template: env.MSG91_TEMPLATE_ID,
  config: env.OTP_PROVIDER_CONFIG,
  resend: env.RESEND_API_KEY,
};
afterEach(() => {
  env.MSG91_AUTH_KEY = original.auth;
  env.MSG91_TEMPLATE_ID = original.template;
  env.OTP_PROVIDER_CONFIG = original.config;
  env.RESEND_API_KEY = original.resend;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('configured MSG91 and email selection', () => {
  it('selects MSG91 through the existing transport when its environment is configured', async () => {
    env.OTP_PROVIDER_CONFIG = undefined;
    env.RESEND_API_KEY = undefined;
    env.MSG91_AUTH_KEY = 'fixture-key';
    env.MSG91_TEMPLATE_ID = 'fixture-template';
    vi.stubEnv('MSG91_AUTH_KEY', 'fixture-key');
    vi.stubEnv('MSG91_TEMPLATE_ID', 'fixture-template');
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ type: 'success', request_id: 'fixture-id' })),
      );
    vi.stubGlobal('fetch', request);
    const result = await createConfiguredOtpProvider({} as Pool).sendSmsOtp('+919876543210');
    expect(result.provider).toBe('msg91_v5');
    expect(new URL(String(request.mock.calls[0]![0])).searchParams.get('template_id')).toBe(
      'fixture-template',
    );
  });
  it('rejects partial MSG91 configuration without exposing the key', () => {
    env.MSG91_AUTH_KEY = 'fixture-private-key';
    env.MSG91_TEMPLATE_ID = undefined;
    expect(() => createConfiguredOtpProvider({} as Pool)).toThrow(
      'MSG91 requires auth key and OTP template ID',
    );
  });
  it('uses configured Resend when no primary HTTP configuration exists', async () => {
    env.MSG91_AUTH_KEY = undefined;
    env.MSG91_TEMPLATE_ID = undefined;
    env.OTP_PROVIDER_CONFIG = undefined;
    env.RESEND_API_KEY = 'fixture-resend-key';
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'fixture-email' })));
    vi.stubGlobal('fetch', request);
    const database = { query: vi.fn(async () => ({ rows: [{ id: 'fixture-session' }] })) };
    const result = await createConfiguredOtpProvider(database as unknown as Pool).sendEmailOtp(
      'fixture@example.com',
    );
    expect(result.provider).toBe('resend');
    expect(request).toHaveBeenCalledTimes(1);
    expect(database.query).toHaveBeenCalledTimes(1);
  });
});
