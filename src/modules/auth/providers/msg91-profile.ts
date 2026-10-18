import { AppError } from '../../../common/errors/app-error.js';
import type { HttpOtpProfile } from './generic-http-otp.provider.js';

/** MSG91 SendOTP v5, not its frontend Widget API. No local OTP is generated. */
export function createMsg91Profile(expiryMinutes = 5, timeoutMs = 10000): HttpOtpProfile {
  if (!Number.isInteger(expiryMinutes) || expiryMinutes < 1 || expiryMinutes > 10)
    throw new AppError('OTP_PROVIDER_CONFIGURATION_INVALID', 'Invalid SMS OTP expiry', 503);
  return {
    id: 'msg91_v5',
    timeoutMs,
    operations: {
      send: {
        url: 'https://control.msg91.com/api/v5/otp',
        method: 'POST',
        headers: { authkey: '{{env:MSG91_AUTH_KEY}}', 'Content-Type': 'application/json' },
        query: {
          template_id: '{{env:MSG91_TEMPLATE_ID}}',
          mobile: '{{recipientDigits}}',
          otp_length: '6',
          otp_expiry: String(expiryMinutes),
        },
        body: {},
        success: [{ path: 'type', equals: 'success' }],
      },
      verify: {
        url: 'https://control.msg91.com/api/v5/otp/verify',
        method: 'GET',
        headers: { authkey: '{{env:MSG91_AUTH_KEY}}' },
        query: { mobile: '{{sessionToken}}', otp: '{{otp}}' },
        success: [
          { path: 'type', equals: 'success' },
          { path: 'message', equals: 'OTP verified success' },
        ],
        invalid: [
          { path: 'message', equals: 'OTP not match' },
          { path: 'message', equals: 'OTP expired' },
        ],
      },
      resend: {
        url: 'https://control.msg91.com/api/v5/otp/retry',
        method: 'GET',
        query: { authkey: '{{env:MSG91_AUTH_KEY}}', mobile: '{{sessionToken}}', retrytype: 'text' },
        success: [
          { path: 'type', equals: 'success' },
          { path: 'message', equals: 'retry send successfully' },
        ],
      },
    },
    response: {
      sessionIdPath: 'request_id',
      sessionTokenValue: '{{recipientDigits}}',
      ttlSeconds: expiryMinutes * 60,
      preserveExpiryOnResend: true,
    },
  };
}
