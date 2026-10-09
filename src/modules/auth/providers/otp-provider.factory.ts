import type { Pool } from 'pg';
import { env } from '../../../config/env.js';
import { PostgresResendOtpSessionRepository } from '../repositories/resend-otp.repository.js';
import { GenericHttpOtpProvider, type HttpOtpConfiguration } from './generic-http-otp.provider.js';
import { ResendOtpProvider } from './resend-otp.provider.js';

/** No active HTTP provider is constructed or validated at application startup. */
export function createConfiguredOtpProvider(pool: Pool) {
  const fallback = env.RESEND_API_KEY
    ? new ResendOtpProvider(new PostgresResendOtpSessionRepository(pool))
    : undefined;
  return new GenericHttpOtpProvider(
    () =>
      env.OTP_PROVIDER_CONFIG !== undefined
        ? (JSON.parse(env.OTP_PROVIDER_CONFIG) as HttpOtpConfiguration)
        : {},
    fallback,
  );
}
