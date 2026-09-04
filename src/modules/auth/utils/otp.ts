import { randomInt } from 'node:crypto';
import { createHash } from 'node:crypto';

const OTP_LENGTH = 6;

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(OTP_LENGTH, '0');
}

export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}
