import type { Response } from 'express';

import { env } from '../../../config/env.js';

const REFRESH_COOKIE_PATH = '/auth';

function parseDurationToMilliseconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);

  if (!match) {
    throw new Error('JWT_REFRESH_EXPIRES_IN must use a duration such as 30d, 24h, 60m, or 3600s');
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * multipliers[unit];
}

function getRefreshCookieMaxAge(): number {
  return parseDurationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN);
}

export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(env.AUTH_REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.AUTH_REFRESH_COOKIE_SECURE,
    sameSite: env.AUTH_REFRESH_COOKIE_SAME_SITE,
    path: REFRESH_COOKIE_PATH,
    maxAge: getRefreshCookieMaxAge(),
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(env.AUTH_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.AUTH_REFRESH_COOKIE_SECURE,
    sameSite: env.AUTH_REFRESH_COOKIE_SAME_SITE,
    path: REFRESH_COOKIE_PATH,
  });
}
