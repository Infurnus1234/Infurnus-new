import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../../../common/crypto/encryption.js';
import { env } from '../../../config/env.js';

export function generateRidePin(): string { return randomInt(0, 10000).toString().padStart(4, '0'); }
export function pinVerifier(rideId: string, pin: string): string {
  const key = createHmac('sha256', Buffer.from(env.AUTH_OTP_ENCRYPTION_KEY, 'base64')).update('infurnus:ride-pin:verifier-key:v1').digest();
  return createHmac('sha256', key)
    .update('infurnus:ride-pin:v1:' + rideId + ':' + pin).digest('hex');
}
export function sealRidePin(rideId: string, pin: string): string {
  return encryptSecret(JSON.stringify({ rideId, pin }));
}
export function openRidePin(rideId: string, value: string): string {
  const payload = JSON.parse(decryptSecret(value)) as {rideId:string;pin:string};
  if (payload.rideId !== rideId || !/^\d{4}$/.test(payload.pin)) throw new Error('Ride PIN envelope invalid');
  return payload.pin;
}
export function matchesPinVerifier(rideId: string, supplied: string, verifier: string): boolean {
  const expected = Buffer.from(pinVerifier(rideId, supplied), 'hex');
  const stored = Buffer.from(verifier, 'hex');
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}

export type PinAttemptResult =
  'verified' | 'invalid' | 'locked' | 'not_found' | 'forbidden' | 'invalid_state';
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 10 * 60 * 1000;

export function evaluatePinAttempt(
  storedPin: string,
  suppliedPin: string,
  metadata: Record<string, unknown>,
  now: number,
): { result: 'verified' | 'invalid' | 'locked'; metadata: Record<string, unknown> } {
  const lockedUntil = typeof metadata.pinLockedUntil === 'number' ? metadata.pinLockedUntil : 0;
  if (lockedUntil > now) return { result: 'locked', metadata };
  const previous = lockedUntil > 0 ? 0 : Number(metadata.pinFailedAttempts ?? 0);
  if (storedPin.length === suppliedPin.length && timingSafeEqual(Buffer.from(storedPin), Buffer.from(suppliedPin))) {
    return {
      result: 'verified',
      metadata: { ...metadata, pinVerified: true, pinFailedAttempts: 0, pinLockedUntil: 0 },
    };
  }
  const attempts = previous + 1;
  return {
    result: attempts >= PIN_MAX_ATTEMPTS ? 'locked' : 'invalid',
    metadata: {
      ...metadata,
      pinFailedAttempts: attempts,
      pinLockedUntil: attempts >= PIN_MAX_ATTEMPTS ? now + PIN_LOCK_MS : 0,
    },
  };
}
