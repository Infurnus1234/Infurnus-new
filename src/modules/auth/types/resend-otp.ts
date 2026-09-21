export interface CreateResendOtpSessionData {
  email: string;
  sessionTokenHash: string;
  otpHash: string;
  expiresAt: Date;
  lastSentAt: Date;
}

export interface ResendOtpSession {
  id: string;
  email: string;
  sessionTokenHash: string;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  lastSentAt: Date;
  consumedAt: Date | null;
}

export interface VerifyResendOtpResult {
  status:
    'verified' | 'not_found' | 'expired' | 'already_consumed' | 'attempts_exceeded' | 'invalid';
  attemptsRemaining?: number;
}

export interface ResendOtpSessionRepository {
  create(data: CreateResendOtpSessionData): Promise<{ id: string }>;

  findBySessionTokenHash(sessionTokenHash: string): Promise<ResendOtpSession | null>;

  verify(sessionTokenHash: string, otpHash: string): Promise<VerifyResendOtpResult>;

  resend(
    sessionTokenHash: string,
    otpHash: string,
    expiresAt: Date,
    lastSentAt: Date,
  ): Promise<boolean>;

  consume(sessionTokenHash: string): Promise<boolean>;
}
