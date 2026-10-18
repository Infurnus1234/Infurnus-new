import { createHmac, randomBytes } from 'node:crypto';

import { Resend, type CreateEmailOptions } from 'resend';

import { env } from '../../../config/env.js';
import { AppError } from '../../../common/errors/app-error.js';
import { generateOtp, hashOtp } from '../utils/otp.js';
import type { ResendOtpSessionRepository } from '../types/resend-otp.js';

const OTP_EXPIRY_MINUTES = (env.AUTH_EMAIL_OTP_TTL_SECONDS ?? 600) / 60;

export class ResendOtpProvider {
  private readonly client: Resend;

  private hashCode(sessionToken: string, otp: string): string {
    return createHmac('sha256', Buffer.from(env.AUTH_OTP_ENCRYPTION_KEY, 'base64'))
      .update('infurnus:email-otp:v1:' + sessionToken + ':' + otp)
      .digest('hex');
  }

  constructor(
    private readonly repository: ResendOtpSessionRepository,
    private readonly timeoutMs = 10000,
  ) {
    if (!env.RESEND_API_KEY) {
      throw new AppError('OTP_PROVIDER_NOT_CONFIGURED', 'Resend API key is not configured', 500);
    }

    this.client = new Resend(env.RESEND_API_KEY);
  }

  private async send(message: CreateEmailOptions) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.client.emails.send(message),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs);
        }),
      ]);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_SEND_FAILED',
        'Email verification service is temporarily unavailable',
        502,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ==========================================================
  // Send Email OTP
  // ==========================================================

  async sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    const otp = generateOtp();
    const sessionToken = randomBytes(32).toString('hex');

    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const lastSentAt = new Date();

    const result = await this.send({
      from: env.RESEND_FROM_EMAIL,
      to: email,
      subject: 'INFURNUS Email Verification OTP',
      text: `Your INFURNUS verification OTP is ${otp}. This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.`,
      html: `
        <div>
          <h2>INFURNUS Email Verification</h2>
          <p>Your verification OTP is:</p>
          <h1>${otp}</h1>
          <p>This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
          <p>If you did not request this OTP, you can ignore this email.</p>
        </div>
      `,
    });

    if (result.error || !result.data?.id) {
      throw new AppError(
        'OTP_PROVIDER_SEND_FAILED',
        'Failed to send email OTP through Resend',
        502,
      );
    }

    const session = await this.repository.create({
      email,
      sessionTokenHash: hashOtp(sessionToken),
      otpHash: this.hashCode(sessionToken, otp),
      expiresAt,
      lastSentAt,
    });

    return {
      sessionId: session.id,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ==========================================================
  // Verify Email OTP
  // ==========================================================

  async verifyEmailOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    const result = await this.repository.verify(
      hashOtp(sessionToken),
      this.hashCode(sessionToken, otp),
      hashOtp(otp),
    );

    if (result.status === 'not_found') {
      throw new AppError('OTP_SESSION_NOT_FOUND', 'OTP session not found', 404);
    }

    if (result.status === 'expired') {
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    }

    if (result.status === 'already_consumed') {
      throw new AppError('OTP_ALREADY_VERIFIED', 'OTP session has already been consumed', 409);
    }

    if (result.status === 'attempts_exceeded') {
      throw new AppError(
        'OTP_ATTEMPTS_EXCEEDED',
        'Maximum OTP verification attempts exceeded',
        429,
      );
    }

    if (result.status === 'invalid') {
      return {
        verified: false,
        attemptsRemaining: result.attemptsRemaining ?? 0,
      };
    }

    return {
      verified: true,
      attemptsRemaining: result.attemptsRemaining ?? 0,
    };
  }

  // ==========================================================
  // Resend Email OTP
  // ==========================================================

  async resendEmailOtp(sessionToken: string): Promise<{ expiresAt: string }> {
    const session = await this.repository.findBySessionTokenHash(hashOtp(sessionToken));

    if (!session) {
      throw new AppError('OTP_SESSION_NOT_FOUND', 'OTP session not found', 404);
    }

    if (session.consumedAt) {
      throw new AppError('OTP_ALREADY_VERIFIED', 'OTP session has already been consumed', 409);
    }

    if (session.expiresAt.getTime() <= Date.now())
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    if (session.attempts >= session.maxAttempts)
      throw new AppError(
        'OTP_ATTEMPTS_EXCEEDED',
        'Maximum OTP verification attempts exceeded',
        429,
      );
    if (
      session.lastSentAt.getTime() >
      Date.now() - (env.AUTH_OTP_RESEND_COOLDOWN_SECONDS ?? 60) * 1000
    )
      throw new AppError('OTP_RESEND_COOLDOWN', 'Please wait before requesting another OTP', 429);
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const lastSentAt = new Date();

    const result = await this.send({
      from: env.RESEND_FROM_EMAIL,
      to: session.email,
      subject: 'INFURNUS Email Verification OTP',
      text: `Your new INFURNUS verification OTP is ${otp}. This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.`,
      html: `
        <div>
          <h2>INFURNUS Email Verification</h2>
          <p>Your new verification OTP is:</p>
          <h1>${otp}</h1>
          <p>This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
        </div>
      `,
    });

    if (result.error || !result.data?.id) {
      throw new AppError(
        'OTP_PROVIDER_SEND_FAILED',
        'Failed to resend email OTP through Resend',
        502,
      );
    }

    const updated = await this.repository.resend(
      hashOtp(sessionToken),
      this.hashCode(sessionToken, otp),
      expiresAt,
      lastSentAt,
    );

    if (!updated) {
      throw new AppError('OTP_SESSION_UPDATE_FAILED', 'Failed to update Resend OTP session', 500);
    }

    return {
      expiresAt: expiresAt.toISOString(),
    };
  }
}
