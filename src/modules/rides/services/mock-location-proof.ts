import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

export const mockLocationGrantSchema = z
  .object({
    driverId: z.string().uuid(),
    customerId: z.string().uuid(),
    sessionId: z.string().uuid(),
    publicKey: z.string().min(1).max(1024),
    startsAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((grant, ctx) => {
    const duration = Date.parse(grant.expiresAt) - Date.parse(grant.startsAt);
    try {
      const key = createPublicKey({
        key: Buffer.from(grant.publicKey, 'base64'),
        format: 'der',
        type: 'spki',
      });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('Expected P-256');
      }
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > 15 * 60_000 ||
        grant.driverId === grant.customerId
      ) {
        throw new Error('Invalid grant scope');
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid device key or mock location grant scope' });
    }
  });

export function verifyMockLocationProof(
  grant: z.infer<typeof mockLocationGrantSchema>,
  identity: { userId: string; sessionId?: string },
  timestamp: Date,
  proof: string,
  now = Date.now(),
): boolean {
  if (
    identity.userId !== grant.driverId ||
    identity.sessionId !== grant.sessionId ||
    now < Date.parse(grant.startsAt) ||
    now >= Date.parse(grant.expiresAt) ||
    timestamp.getTime() > now + 2000 ||
    timestamp.getTime() < now - 30_000
  )
    return false;
  const message = [
    'infurnus:patna-mock-location:v1',
    grant.driverId,
    grant.sessionId,
    timestamp.toISOString(),
  ].join('\n');
  return verify(
    'sha256',
    Buffer.from(message),
    {
      key: Buffer.from(grant.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    },
    Buffer.from(proof, 'base64'),
  );
}
