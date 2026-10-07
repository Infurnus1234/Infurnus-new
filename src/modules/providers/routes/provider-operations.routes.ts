import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import {
  requireProvider,
  requireFleetOwner,
  requireDriver,
  requireAdminOrSuperAdmin,
} from '../../auth/middleware/authorization.middleware.js';
import type { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { storageService } from '../../../infrastructure/storage/index.js';

export function createProviderOperationsRouter(repository: PostgresProviderOperationsRepository) {
  const router = Router();
  router.use(
    requireAuth,
    requireProvider(),
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => req.auth!.userId,
    }),
  );
  router.patch('/drivers/:id/membership', requireFleetOwner(), async (req, res, next) => {
    try {
      z.object({ status: z.literal('INACTIVE') })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        data: await repository.deactivateMembership(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/drivers/:id/profile', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        success: true,
        data: await repository.driverProfile(req.auth!.userId, req.auth!.role, id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/drivers/:id/documents', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        success: true,
        data: await repository.driverDocuments(req.auth!.userId, req.auth!.role, id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/drivers/:id/documents/:documentId/access-url', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const documentId = z.string().uuid().parse(req.params.documentId);
      const document = await repository.driverDocumentAccess(
        req.auth!.userId,
        req.auth!.role,
        id,
        documentId,
      );
      res.json({
        success: true,
        data: {
          accessUrl: await storageService.getAccessUrl({
            ...document,
            options: { expiresIn: 300 },
          }),
          expiresIn: 300,
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/approval-requests', async (req, res, next) => {
    try {
      if (
        req.auth!.role === 'driver_fleet_owner' &&
        req.headers['x-provider-mode'] === 'driver' &&
        req.body?.requestType === 'driver_association'
      )
        throw new (await import('../../../common/errors/app-error.js')).AppError(
          'FORBIDDEN',
          'Fleet mode required',
          403,
        );
      const input = z
        .object({
          targetType: z.enum([
            'driver_profile',
            'driver_document',
            'partner',
            'partner_document',
            'vehicle',
            'bank_account',
          ]),
          targetId: z.string().uuid(),
          requestType: z.enum([
            'driver_onboarding',
            'driver_verification',
            'identity_verification',
            'licence_verification',
            'vehicle_verification',
            'rc_verification',
            'insurance_verification',
            'puc_verification',
            'fleet_verification',
            'profile_verification',
            'document_reverification',
            'compliance_review',
            'account_activation',
            'driver_association',
            'bank_verification',
          ]),
        })
        .strict()
        .parse(req.body);
      res.status(201).json({
        success: true,
        data: await repository.requestApproval(req.auth!.userId, req.auth!.role, input),
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/vehicles/:id/operation', requireFleetOwner(), async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const input = z
        .object({
          operationalStatus: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).optional(),
          maintenanceNotes: z.string().trim().max(1000).optional(),
          lastServiceDate: z.iso.date().optional(),
          nextServiceDate: z.iso.date().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
        .parse(req.body);
      res.json({
        success: true,
        data: await repository.manageVehicle(req.auth!.userId, req.auth!.role, id, input),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/document-requirements', async (req, res, next) => {
    try {
      const query = z
        .object({ category: z.string().trim().min(1).max(50).default('*') })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: await repository.documentRequirements(
          req.auth!.userId,
          req.auth!.role,
          query.category,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/tracking', requireFleetOwner(), async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repository.tracking(req.auth!.userId, req.auth!.role),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/location', requireDriver(), async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repository.ownLocation(req.auth!.userId, req.auth!.role),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/drivers/:id/location-history', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        success: true,
        data: await repository.locationHistory(req.auth!.userId, req.auth!.role, id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/approvals', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repository.approvals(req.auth!.userId, req.auth!.role),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/approvals/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        success: true,
        data: await repository.approval(req.auth!.userId, req.auth!.role, id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/vehicles/:id/association-history', requireFleetOwner(), async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        success: true,
        data: await repository.associationHistory(req.auth!.userId, req.auth!.role, id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/earnings', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repository.earnings(req.auth!.userId, req.auth!.role),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export function createProviderApprovalRouter(repository: PostgresProviderOperationsRepository) {
  const router = Router();
  router.use(
    requireAuth,
    requireAdminOrSuperAdmin(),
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => req.auth!.userId,
    }),
  );
  router.get('/document-policies', async (req, res, next) => {
    try {
      res.json({ success: true, data: await repository.documentPolicies(req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });
  router.put('/document-policies', async (req, res, next) => {
    try {
      const input = z
        .object({
          providerRole: z.enum(['driver', 'fleet_owner', 'driver_fleet_owner']),
          category: z.string().trim().min(1).max(50),
          documentCode: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
          required: z.boolean(),
          requiresExpiry: z.boolean(),
          minimumPages: z.number().int().min(1).max(5),
          active: z.boolean(),
        })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        data: await repository.configureDocumentRequirement(req.auth!.userId, input),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/', async (req, res, next) => {
    try {
      res.json({ success: true, data: await repository.pendingApprovals(req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repository.approvalDetails(
          req.auth!.userId,
          z.string().uuid().parse(req.params.id),
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id/documents/:documentId/access-url', async (req, res, next) => {
    try {
      const query = z
        .object({ page: z.coerce.number().int().min(1).max(5).optional() })
        .strict()
        .parse(req.query);
      const document = await repository.approvalDocumentAccess(
        req.auth!.userId,
        z.string().uuid().parse(req.params.id),
        z.string().uuid().parse(req.params.documentId),
        query.page,
      );
      res.json({
        success: true,
        data: {
          accessUrl: await storageService.getAccessUrl({
            ...document,
            options: { expiresIn: 300 },
          }),
          expiresIn: 300,
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/:id/review', async (req, res, next) => {
    try {
      const input = z
        .object({
          status: z.enum(['APPROVED', 'REJECTED']),
          reason: z.string().trim().min(1).max(1000).optional(),
          expectedUpdatedAt: z.iso.datetime(),
        })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        data: await repository.reviewApproval(
          req.auth!.userId,
          z.string().uuid().parse(req.params.id),
          input,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
