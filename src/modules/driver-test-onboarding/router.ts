import { hkdfSync, randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../infrastructure/database/postgres.js';
import { AppError } from '../../common/errors/app-error.js';
import {
  createRequiredMultipleFileUpload,
  createRequiredSingleFileUpload,
} from '../../infrastructure/storage/multipart.js';
import type { DriverController } from '../rides/controllers/driver.controller.js';
import type { UserController } from '../users/controllers/user.controller.js';
import { updateUserSchema } from '../users/schemas/user.schemas.js';
import type { PostgresProviderOperationsRepository } from '../providers/repositories/provider-operations.repository.js';
import { createProviderOperationsRouter } from '../providers/routes/provider-operations.routes.js';

const audience = 'infurnus-local-driver-onboarding';
const key = new Uint8Array(
  hkdfSync('sha256', env.JWT_ACCESS_SECRET, audience, 'temporary-session-v1', 32),
);
export function testOnboardingEnabled(): boolean {
  return (
    env.DRIVER_TEST_ONBOARDING_ENABLED === 'true' && ['development', 'test'].includes(env.NODE_ENV)
  );
}

// Separate key, audience and token type: these tokens cannot authenticate normal APIs.
export async function issueTestOnboardingToken(userId: string, expiresIn = '1h') {
  return new SignJWT({ type: 'driver-test-onboarding' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export function createTestOnboardingRouter(
  driver: DriverController,
  user: UserController,
  providers: PostgresProviderOperationsRepository,
) {
  const router = Router();
  router.get('/capabilities', (_req, res) =>
    res.json({ success: true, data: { enabled: testOnboardingEnabled() } }),
  );
  router.use((_req, _res, next) => {
    if (!testOnboardingEnabled()) return next(new AppError('NOT_FOUND', 'Not found', 404));
    next();
  });
  router.use(
    rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  router.post(
    '/sessions',
    rateLimit({ windowMs: 3600_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }),
    async (req, res, next) => {
      try {
        z.object({}).strict().parse(req.body);
        const userId = randomUUID();
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,phone,role,email_verified,phone_verified) VALUES($1::uuid,'','','test-driver-'||$1::uuid::text||'@example.invalid',NULL,'driver',FALSE,FALSE)",
          [userId],
        );
        res.status(201).json({
          success: true,
          data: { userId, sessionToken: await issueTestOnboardingToken(userId) },
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.use(async (req, _res, next) => {
    try {
      const match = /^Bearer ([^\s]+)$/.exec(req.header('authorization') ?? '');
      if (!match) throw Error('Missing session');
      const { payload } = await jwtVerify(match[1]!, key, { algorithms: ['HS256'], audience });
      const id = z.string().uuid().parse(payload.sub);
      if (payload.type !== 'driver-test-onboarding') throw Error('Wrong session type');
      const found = await pool.query(
        "SELECT id FROM users WHERE id=$1 AND email=$2 AND role='driver' AND status='active' AND NOT email_verified AND NOT phone_verified AND deleted_at IS NULL",
        [id, `test-driver-${id}@example.invalid`],
      );
      if (!found.rowCount) throw Error('Session identity unavailable');
      req.auth = { userId: id, role: 'driver' };
      next();
    } catch {
      next(
        new AppError(
          'INVALID_TEST_ONBOARDING_SESSION',
          'Temporary onboarding session expired or invalid',
          401,
        ),
      );
    }
  });
  const ownUser: RequestHandler = (req, _res, next) => {
    if (req.params.id !== req.auth!.userId)
      return next(new AppError('FORBIDDEN', 'Another account is not accessible', 403));
    next();
  };
  router.get('/users/:id', ownUser, user.getById);
  router.patch(
    '/users/:id',
    ownUser,
    (req, _res, next) => {
      try {
        z.object({
          firstName: updateUserSchema.shape.firstName,
          lastName: updateUserSchema.shape.lastName,
        })
          .strict()
          .refine((value) => Object.keys(value).length > 0)
          .parse(req.body);
        next();
      } catch (error) {
        next(error);
      }
    },
    user.update,
  );
  router.get('/rides/driver/profile', driver.getProfile);
  router.post('/rides/driver/profile', driver.upsertProfile);
  router.get('/rides/driver/assigned-vehicle', driver.getAssignedVehicle);
  router.get('/rides/driver/documents', driver.listDocuments);
  router.get('/rides/driver/documents/:documentId', driver.getDocument);
  router.get('/rides/driver/documents/:documentId/access-url', driver.getDocumentAccessUrl);
  router.get(
    '/rides/driver/documents/:documentId/pages/access-urls',
    driver.getDocumentPageAccessUrls,
  );
  router.post(
    '/rides/driver/documents/:documentType',
    ...createRequiredSingleFileUpload({ fieldName: 'file' }),
    driver.uploadDocument,
  );
  router.post(
    '/rides/driver/documents/:documentType/pages',
    ...createRequiredMultipleFileUpload({ fieldName: 'files', maxFiles: 5 }),
    driver.uploadDocumentPages,
  );
  // Reuse provider validation/ownership checks, exposing only onboarding reads/submission.
  router.use(
    '/provider',
    (req, _res, next) => {
      const allowed =
        (req.method === 'GET' && ['/document-requirements', '/approvals'].includes(req.path)) ||
        (req.method === 'POST' && req.path === '/approval-requests');
      if (!allowed)
        return next(new AppError('FORBIDDEN', 'Outside temporary onboarding scope', 403));
      if (
        req.method === 'POST' &&
        !['driver_profile', 'driver_document'].includes(req.body?.targetType)
      )
        return next(new AppError('FORBIDDEN', 'Only driver onboarding review is permitted', 403));
      next();
    },
    createProviderOperationsRouter(providers, (_req, _res, next) => next()),
  );
  router.use((_req, _res, next) =>
    next(new AppError('FORBIDDEN', 'Outside temporary onboarding scope', 403)),
  );
  return router;
}
