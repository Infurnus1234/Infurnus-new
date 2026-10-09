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
  if (storedPin === suppliedPin) {
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
