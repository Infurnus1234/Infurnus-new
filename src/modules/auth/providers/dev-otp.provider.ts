import type { OtpProvider } from './otp.provider.js';

export class DevOtpProvider implements OtpProvider {
  async sendEmailOtp(_email: string, _otp: string): Promise<void> {
    // Intentionally empty.
    // Never log OTP values.
  }

  async sendSmsOtp(_phone: string, _otp: string): Promise<void> {
    // Intentionally empty.
    // Never log OTP values.
  }
}
