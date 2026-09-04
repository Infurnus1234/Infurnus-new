import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../common/errors/app-error.js';

export function requireRoles(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401));
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      next(new AppError('FORBIDDEN', 'You do not have permission to perform this action', 403));
      return;
    }

    next();
  };
}
