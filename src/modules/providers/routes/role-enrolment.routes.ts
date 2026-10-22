import { pool } from '../../../infrastructure/database/postgres.js';
import { FleetInvitationRepository } from '../repositories/fleet-invitation.repository.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { RoleEnrolmentRepository } from '../repositories/role-enrolment.repository.js';
import {
  requireFleetOwner,
  requireFleetFinancialContext,
} from '../../auth/middleware/authorization.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { createRequiredSingleFileUpload } from '../../../infrastructure/storage/multipart.js';
import { storageService } from '../../../infrastructure/storage/index.js';
import { AppError } from '../../../common/errors/app-error.js';
export function createRoleEnrolmentRouter(repo: RoleEnrolmentRepository) {
  const router = Router();
  const invitations = new FleetInvitationRepository(pool);
  router.get('/fleet-invitations', async (req, res, next) => {
    try {
      res.json({ success: true, data: await invitations.list(req.auth!.userId, req.auth!.role) });
    } catch (e) {
      next(e);
    }
  });
  router.post('/fleet-invitations/:id/accept', async (req, res, next) => {
    try {
      z.object({}).strict().parse(req.body);
      res.json({
        success: true,
        data: await invitations.accept(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get('/enrolment', async (req, res, next) => {
    try {
      res.json({ success: true, data: await repo.state(req.auth!.userId, req.auth!.role) });
    } catch (e) {
      next(e);
    }
  });
  router.patch('/enrolment', async (req, res, next) => {
    try {
      const input = z
        .union([
          z.object({ step: z.string().max(40), skipped: z.boolean() }).strict(),
          z.object({ complete: z.literal(true) }).strict(),
          z.object({ deferSetup: z.literal(true) }).strict(),
        ])
        .parse(req.body);
      res.json({ success: true, data: await repo.state(req.auth!.userId, req.auth!.role, input) });
    } catch (e) {
      next(e);
    }
  });
  router.post('/enrolment/role', async (req, res, next) => {
    try {
      const { role } = z
        .object({ role: z.enum(['driver', 'driver_fleet_owner', 'fleet_owner']) })
        .strict()
        .parse(req.body);
      await repo.selectRole(req.auth!.userId, req.auth!.role, role);
      res.json({
        success: true,
        data: {
          role,
          accessToken: await signAccessToken({ sub: req.auth!.userId, role, type: 'access' }),
        },
      });
    } catch (e) {
      next(e);
    }
  });
  router.post(
    '/enrolment/verify-code',
    rateLimit({
      windowMs: 900000,
      limit: 10,
      keyGenerator: (req) => req.auth!.userId,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res, next) => {
      try {
        const { code } = z
          .object({ code: z.string().regex(/^[A-Fa-f0-9]{12}$/) })
          .strict()
          .parse(req.body);
        res.json({
          success: true,
          data: await repo.verifyCode(req.auth!.userId, req.auth!.role, code),
        });
      } catch (e) {
        next(e);
      }
    },
  );
  router.get('/fleet-finance', requireFleetFinancialContext(), async (req, res, next) => {
    try {
      const month = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(req.query.month);
      res.json({
        success: true,
        data: await repo.fleetReport(req.auth!.userId, req.auth!.role, month),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get('/fleet-drivers', requireFleetOwner(), async (req, res, next) => {
    try {
      res.json({ success: true, data: await repo.invitations(req.auth!.userId, req.auth!.role) });
    } catch (e) {
      next(e);
    }
  });
  router.post('/fleet-drivers', requireFleetOwner(), async (req, res, next) => {
    try {
      const { email, driverUserId } = z
        .object({ email: z.string().email().max(320), driverUserId: z.string().uuid().optional() })
        .strict()
        .parse(req.body);
      res.status(201).json({
        success: true,
        data: await repo.addDriver(req.auth!.userId, req.auth!.role, email, driverUserId),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get('/enrolment/photo', async (req, res, next) => {
    try {
      const photo = await repo.photo(req.auth!.userId, req.auth!.role);
      res.json({
        success: true,
        data: photo
          ? {
              accessUrl: await storageService.getAccessUrl({
                ...photo,
                options: { expiresIn: 300 },
              }),
            }
          : null,
      });
    } catch (e) {
      next(e);
    }
  });
  router.post('/enrolment/photo', ...createRequiredSingleFileUpload(), async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) throw new AppError('FILE_REQUIRED', 'Choose a profile image', 400);
      const b = file.buffer;
      const detected =
        b[0] === 255 && b[1] === 216 && b[2] === 255
          ? 'image/jpeg'
          : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? 'image/png'
            : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
              ? 'image/webp'
              : null;
      if (!detected || file.mimetype !== detected)
        throw new AppError('INVALID_IMAGE', 'Choose a valid JPEG, PNG or WebP image', 400);
      const state = await repo.state(req.auth!.userId, req.auth!.role);
      if (state.roleSelectionPending)
        throw new AppError('ONBOARDING_INCOMPLETE', 'Choose your account role first', 403);
      const saved = await storageService.upload({
        file: {
          buffer: b,
          mimeType: detected,
          originalFileName: file.originalname,
          fileSize: file.size,
        },
        folder: `provider-profile/${req.auth!.userId}`,
        resourceType: 'image',
        accessMode: 'authenticated',
      });
      try {
        await repo.savePhoto(req.auth!.userId, req.auth!.role, saved);
      } catch (e) {
        await storageService.delete(saved);
        throw e;
      }
      res.status(201).json({ success: true, data: { saved: true } });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
