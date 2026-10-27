import { SignJWT, jwtVerify } from 'jose';

import { env } from '../../../config/env.js';
import type { AccessTokenPayload } from '../types/token.js';
import { isDeletedSubject } from '../services/deleted-subjects.js';
import { activeAccessSession } from '../repositories/access-session.repository.js';

const currentSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

const previousSecret = env.JWT_ACCESS_PREVIOUS_SECRET
  ? new TextEncoder().encode(env.JWT_ACCESS_PREVIOUS_SECRET)
  : undefined;

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
    .sign(currentSecret);
}

async function verifyWithSecret(token: string, secret: Uint8Array): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
    requiredClaims: ['sub', 'iat', 'exp'],
  });

  if (
    isDeletedSubject(String(payload.sub)) ||
    typeof payload.sub !== 'string' ||
    payload.type !== 'access' ||
    typeof payload.role !== 'string'
  ) {
    throw new Error('Invalid access token payload');
  }

  // Legacy signed tokens remain compatible until their expiry. Deployment must
  // retire pre-session-binding signing keys to revoke those tokens immediately.
  if (payload.sid !== undefined) {
    if (
      typeof payload.sid !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sid) ||
      !(await activeAccessSession(payload.sub, payload.sid, payload.role))
    ) {
      throw new Error('Access session is not active');
    }
  }

  return {
    sub: payload.sub,
    role: payload.role,
    type: 'access',
    ...(typeof payload.sid === 'string' ? { sid: payload.sid } : {}),
  };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    return await verifyWithSecret(token, currentSecret);
  } catch (currentSecretError) {
    if (!previousSecret) {
      throw currentSecretError;
    }

    return verifyWithSecret(token, previousSecret);
  }
}
