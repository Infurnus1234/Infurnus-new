import type { RequestHandler } from 'express';
import { AppError } from '../../../common/errors/app-error.js';
import { verifyAccessToken } from '../../auth/utils/jwt.js';
import type { AdminManagementService } from '../services/admin-management.service.js';
import { requiredPermissions } from '../services/permission-policy.js';

export function redactContactData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactContactData);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/email|phone|address|bank|accountnumber|contact|documentnumber|licen[cs]enumber|^dob$|^gender$|^pincode$/i.test(
            key.replaceAll('_', ''),
          ),
      )
      .map(([key, field]) => [key, redactContactData(field)]),
  );
}
// Installed once before every application router, including native vehicle and media routes.
// Router role/ownership checks remain authoritative in addition to these grants.
export function administrativePermissionGate(
  service: Pick<AdminManagementService, 'identity'>,
): RequestHandler {
  return async (req, res, next) => {
    // These endpoints validate their own Google identity, OTP, password or refresh cookie. An old access
    // cookie must never prevent signing in, rotating a session or revoking that session.
    if (
      req.method === 'POST' &&
      [
        '/auth/admin/login',
        '/auth/login',
        '/auth/login/verify',
        '/auth/login/resend',
        '/auth/google',
        '/auth/signup',
        '/auth/signup/verify',
        '/auth/signup/resend',
        '/auth/forgot-password',
        '/auth/forgot-password/verify',
        '/auth/reset-password',
        '/auth/refresh',
        '/auth/logout',
      ].includes(req.path.replace(/\/+$/, ''))
    ) {
      next();
      return;
    }
    const authorization = req.header('authorization');
    if (!authorization) {
      next();
      return;
    }
    try {
      const match = authorization.match(/^Bearer\s+(\S+)$/);
      if (!match) {
        next();
        return;
      }
      const claims = await verifyAccessToken(match[1]!).catch(() => {
        throw new AppError('INVALID_ACCESS_TOKEN', 'Invalid or expired access token', 401);
      });
      if (!['admin', 'super_admin'].includes(claims.role)) {
        next();
        return;
      }
      const identity = await service.identity(claims.sub, claims.role);
      if (identity.role !== claims.role)
        throw new AppError('FORBIDDEN', 'Administrative role changed; sign in again', 403);
      if (identity.role === 'super_admin') {
        next();
        return;
      }
      const required = requiredPermissions(req.method, req.path, req.body);
      if (
        required === null ||
        (required.length > 0 && identity.scoped) ||
        required.some((key) => !identity.permissions.includes(key))
      )
        throw new AppError('FORBIDDEN', 'This action is not granted to your Admin account', 403);
      res.locals.adminPermissions = identity.permissions;
      const entity =
        (/^\/(?:provider-approvals|driver-applications)(?:\/|$)/.test(req.path) ||
        req.path.startsWith('/admin/drivers/applications')
          ? 'approvals'
          : undefined) ||
        (/^\/partners(?:\/|$)/.test(req.path) ? 'partners' : undefined) ||
        req.path.match(/^\/admin\/(?:reports\/)?(users|drivers|partners)(?:\/|$)/)?.[1] ||
        (req.path.startsWith('/provider-approvals') ? 'approvals' : undefined);
      if (entity && !identity.permissions.includes(`${entity}.sensitive`)) {
        const json = res.json.bind(res);
        res.json = (body) => json(redactContactData(body));
      }
      if (entity) {
        const json = res.json.bind(res);
        res.json = (body) => {
          const prune = (value: unknown): unknown => {
            if (Array.isArray(value)) return value.map(prune);
            if (!value || typeof value !== 'object' || value instanceof Date) return value;
            return Object.fromEntries(
              Object.entries(value).map(([key, field]) => [
                key,
                (key === 'documents' && !identity.permissions.includes(`${entity}.documents`)) ||
                (['vehicles', 'drivers', 'partners'].includes(key) &&
                  !identity.permissions.includes(`${key}.read`))
                  ? []
                  : prune(field),
              ]),
            );
          };
          return json(prune(body));
        };
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
