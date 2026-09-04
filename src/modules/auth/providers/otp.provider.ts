export interface OtpProvider {
  sendEmailOtp(email: string, otp: string): Promise<void>;

  sendSmsOtp(phone: string, otp: string): Promise<void>;
}
