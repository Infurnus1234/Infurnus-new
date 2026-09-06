import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
import { verifyCsrfToken } from '../utils/csrf.js';

export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.[env.AUTH_CSRF_COOKIE_NAME];
  const headerToken = req.get('X-CSRF-Token');

  if (
    typeof cookieToken !== 'string' ||
    !cookieToken ||
    typeof headerToken !== 'string' ||
    !headerToken
  ) {
    next(new AppError('CSRF_TOKEN_REQUIRED', 'CSRF token required', 403));
    return;
  }

  if (!verifyCsrfToken(cookieToken, headerToken)) {
    next(new AppError('INVALID_CSRF_TOKEN', 'Invalid CSRF token', 403));
    return;
  }

  next();
}
