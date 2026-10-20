import { AppError } from '../../../common/errors/app-error.js';
import { createMsg91Profile } from './msg91-profile.js';
import type { Pool } from 'pg';
import { env } from '../../../config/env.js';
import { PostgresResendOtpSessionRepository } from '../repositories/resend-otp.repository.js';
import { GenericHttpOtpProvider, type HttpOtpConfiguration } from './generic-http-otp.provider.js';
import { ResendOtpProvider } from './resend-otp.provider.js';

/** Provider profiles share the existing HTTP transport and encrypted challenge storage. */
export function createConfiguredOtpProvider(pool: Pool) {
  const fallback = env.RESEND_API_KEY
    ? new ResendOtpProvider(new PostgresResendOtpSessionRepository(pool))
    : undefined;
  if (
    (env.MSG91_AUTH_KEY || env.MSG91_TEMPLATE_ID) &&
    !(env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID)
  ) {
    throw new AppError(
      'OTP_PROVIDER_NOT_CONFIGURED',
      'MSG91 requires auth key and OTP template ID',
      503,
    );
  }
  return new GenericHttpOtpProvider(() => {
    const config: HttpOtpConfiguration =
      env.OTP_PROVIDER_CONFIG !== undefined
        ? (JSON.parse(env.OTP_PROVIDER_CONFIG) as HttpOtpConfiguration)
        : { emailFallbackOnMissing: Boolean(fallback) };
    if (!config.sms && env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID)
      config.sms = createMsg91Profile(env.MSG91_OTP_EXPIRY_MINUTES, env.MSG91_TIMEOUT_MS);
    return config;
  }, fallback);
}
