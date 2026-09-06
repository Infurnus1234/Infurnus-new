import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/errors/app-error.js';
import { verifyAccessToken } from '../utils/jwt.js';

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authorization = req.header('authorization');

  if (!authorization) {
    next(new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401));
    return;
  }

  const parts = authorization.trim().split(/\s+/);

  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    next(new AppError('INVALID_AUTHORIZATION_HEADER', 'Invalid authorization header', 401));
    return;
  }

  const token = parts[1];

  try {
    const payload = await verifyAccessToken(token);

    req.auth = {
      userId: payload.sub,
      role: payload.role,
    };

    next();
  } catch {
    next(new AppError('INVALID_ACCESS_TOKEN', 'Invalid or expired access token', 401));
  }
}
