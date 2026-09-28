import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../common/errors/app-error.js';

type AuthorizationRole =
  'user' | 'driver' | 'fleet_owner' | 'driver_fleet_owner' | 'admin' | 'super_admin';

function getEffectiveRoles(req: Request): string[] {
  if (!req.auth) {
    return [];
  }

  const userRole = req.auth.role as AuthorizationRole;
  const mode = (req.headers['x-provider-mode'] as string | undefined)?.toLowerCase();

  if (userRole === 'driver_fleet_owner') {
    if (mode === 'driver') {
      return ['driver'];
    }

    if (mode === 'fleet_owner') {
      return ['fleet_owner'];
    }

    return ['driver', 'fleet_owner', 'driver_fleet_owner'];
  }

  return [userRole];
}

export function requireRoles(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401));
      return;
    }

    const effectiveRoles = getEffectiveRoles(req);

    const hasPermission = allowedRoles.some((role) => effectiveRoles.includes(role));

    if (!hasPermission) {
      next(new AppError('FORBIDDEN', 'You do not have permission to perform this action', 403));
      return;
    }

    next();
  };
}

export function requireSuperAdmin() {
  return requireRoles('super_admin');
}

export function requireAdminOrSuperAdmin() {
  return requireRoles('admin', 'super_admin');
}

export function requireDriver() {
  return requireRoles('driver');
}

export function requireFleetOwner() {
  return requireRoles('fleet_owner');
}

export function requireProvider() {
  return requireRoles('driver', 'fleet_owner', 'driver_fleet_owner');
}
