import type { Response } from 'express';

import { env } from '../../../config/env.js';

const CSRF_COOKIE_PATH = '/auth';

export function setCsrfTokenCookie(res: Response, csrfToken: string): void {
  res.cookie(env.AUTH_CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: env.AUTH_CSRF_COOKIE_SECURE,
    sameSite: env.AUTH_CSRF_COOKIE_SAME_SITE,
    path: CSRF_COOKIE_PATH,
  });
}

export function clearCsrfTokenCookie(res: Response): void {
  res.clearCookie(env.AUTH_CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: env.AUTH_CSRF_COOKIE_SECURE,
    sameSite: env.AUTH_CSRF_COOKIE_SAME_SITE,
    path: CSRF_COOKIE_PATH,
  });
}
