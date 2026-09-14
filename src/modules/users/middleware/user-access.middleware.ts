import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/errors/app-error.js';

export function requireSelf(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401));
    return;
  }

  if (req.auth.userId !== req.params.id) {
    next(new AppError('FORBIDDEN', 'You do not have permission to access this user', 403));
    return;
  }

  next();
}
