import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../../config/env.js';
import type { AccessTokenPayload } from '../types/token.js';

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
  });

  if (
    typeof payload.sub !== 'string' ||
    payload.type !== 'access' ||
    typeof payload.role !== 'string'
  ) {
    throw new Error('Invalid access token payload');
  }

  return {
    sub: payload.sub,
    role: payload.role,
    type: 'access',
  };
}
