export type SignupContactType = 'email' | 'phone';

export interface PendingSignup {
  id: string;
  firstName: string;
  lastName: string;
  contactType: SignupContactType;
  contactValue: string;
  passwordHash: string;
  role: string;
  otpHash: string;
  otpExpiresAt: Date;
  otpAttempts: number;
  otpVerifiedAt: Date | null;
  lastOtpSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePendingSignupData {
  firstName: string;
  lastName: string;
  contactType: SignupContactType;
  contactValue: string;
  passwordHash: string;
  role: string;
  otpHash: string;
  otpExpiresAt: Date;
}
