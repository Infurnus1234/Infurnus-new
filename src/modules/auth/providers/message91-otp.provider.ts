import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { SmsOtpProvider } from './otp.provider.js';

export interface Message91OtpConfig {
  apiKey: string;
  baseUrl: string;
  templateId: string;
  senderId?: string;
  expiryMinutes: number;
  timeoutMs: number;
}

/** MSG91 SendOTP v5: provider generates and verifies the OTP; tokens stay encrypted at rest. */
export class Message91OtpProvider implements SmsOtpProvider {
  constructor(
    private readonly config: Message91OtpConfig,
    private readonly request = fetch,
  ) {
    const url = new URL(config.baseUrl);
    if (
      !config.apiKey ||
      !config.templateId ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new AppError(
        'OTP_PROVIDER_NOT_CONFIGURED',
        'MSG91 requires an API key, template ID and HTTPS API URL',
        503,
      );
    }
  }

  async sendSmsOtp(phone: string) {
    const mobile = this.mobile(phone);
    const result = await this.call('', 'POST', {
      mobile,
      template_id: this.config.templateId,
      otp_expiry: String(this.config.expiryMinutes),
      otp_length: '6',
      ...(this.config.senderId ? { sender: this.config.senderId } : {}),
    });
    this.requireSuccess(result, 'SEND');
    return {
      sessionId: randomUUID(),
      sessionToken: mobile,
      expiresAt: this.expiry(),
      provider: 'message91',
    };
  }

  async verifySmsOtp(sessionToken: string, otp: string) {
    if (!/^\d{6}$/.test(otp)) {
      throw new AppError('INVALID_OTP', 'Invalid verification code', 400);
    }
    const result = await this.call('/verify', 'GET', { mobile: this.mobile(sessionToken), otp });
    if (result.type === 'success' && result.message === 'OTP verified success') {
      return { verified: true, attemptsRemaining: null };
    }
    if (
      result.type === 'error' &&
      /invalid otp|otp not match|otp expired|otp not valid/i.test(result.message)
    ) {
      // MSG91 does not return an attempts-remaining count. Do not fabricate one.
      return { verified: false, attemptsRemaining: null };
    }
    throw this.failure('VERIFY');
  }

  async resendSmsOtp(sessionToken: string) {
    const result = await this.call('/retry', 'GET', {
      mobile: this.mobile(sessionToken),
      retrytype: 'text',
    });
    this.requireSuccess(result, 'RESEND');
    return { expiresAt: this.expiry() };
  }

  private mobile(phone: string) {
    const value = phone.replace(/^\+/, '');
    if (!/^[1-9]\d{7,14}$/.test(value)) {
      throw new AppError(
        'OTP_PROVIDER_SESSION_INVALID',
        'Invalid SMS OTP destination/session',
        400,
      );
    }
    return value;
  }

  private expiry() {
    return new Date(Date.now() + this.config.expiryMinutes * 60000).toISOString();
  }

  private failure(operation: string) {
    return new AppError(
      `OTP_PROVIDER_${operation}_FAILED`,
      'SMS verification service is temporarily unavailable',
      502,
    );
  }

  private requireSuccess(result: { type: string; message: string }, operation: string) {
    if (result.type !== 'success') throw this.failure(operation);
  }

  private async call(path: string, method: 'GET' | 'POST', parameters: Record<string, string>) {
    const operation = path === '/verify' ? 'VERIFY' : path === '/retry' ? 'RESEND' : 'SEND';
    try {
      const url = new URL(`${this.config.baseUrl.replace(/\/$/, '')}/otp${path}`);
      url.search = new URLSearchParams(parameters).toString();
      const response = await this.request(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { authkey: this.config.apiKey, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      if (!response.ok) throw this.failure(operation);
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('type' in result) ||
        !('message' in result) ||
        typeof result.type !== 'string' ||
        typeof result.message !== 'string'
      )
        throw this.failure(operation);
      return { type: result.type, message: result.message };
    } catch {
      // Provider responses/URLs may contain keys, phone numbers or OTPs; never log them.
      throw this.failure(operation);
    }
  }
}
