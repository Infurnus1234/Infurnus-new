import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../common/errors/app-error.js';

export function requireRoles(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401));
      return;
    }

    const userRole = req.auth.role;
    const mode = (req.headers['x-provider-mode'] as string | undefined)?.toLowerCase();

    let effectiveRoles = [userRole];
    if (userRole === 'driver_fleet_owner') {
      if (mode === 'driver') {
        effectiveRoles = ['driver'];
      } else if (mode === 'fleet_owner') {
        effectiveRoles = ['fleet_owner'];
      } else {
        effectiveRoles = ['driver', 'fleet_owner', 'driver_fleet_owner'];
      }
    }

    const hasPermission = allowedRoles.some((role) => effectiveRoles.includes(role));

    if (!hasPermission) {
      next(new AppError('FORBIDDEN', 'You do not have permission to perform this action', 403));
      return;
    }

    next();
  };
}

