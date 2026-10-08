import { AppError } from '../../../common/errors/app-error.js';
import { FallbackOtpProvider } from './fallback-otp.provider.js';
import type { ResendOtpProvider } from './resend-otp.provider.js';
import type { OtpProvider, SmsOtpProvider } from './otp.provider.js';

/** Reuses existing providers; production authentication must never log development OTPs. */
export function selectOtpProvider(
  primary: OtpProvider | undefined,
  fallback: ResendOtpProvider | undefined,
  development: () => OtpProvider,
  production: boolean,
  sms?: { name: string; adapter: SmsOtpProvider },
): OtpProvider {
  if (primary || sms) return new FallbackOtpProvider(primary, fallback, sms);
  if (production)
    throw new AppError(
      'AUTH_OTP_PROVIDER_NOT_CONFIGURED',
      'Production authentication provider is not configured',
      503,
    );
  return development();
}
