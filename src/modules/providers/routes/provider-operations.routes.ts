import { FleetOwnerOverviewRepository } from '../repositories/fleet-owner-overview.repository.js';
import {
  FleetOwnerRequestsRepository,
  fleetRequestCategories,
} from '../repositories/fleet-owner-requests.repository.js';
import { createProviderAccountRouter } from './provider-account.routes.js';
import { PostgresFleetRepository } from '../../fleet/repositories/fleet.repository.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { createManagedDriverRouter } from './managed-driver.routes.js';
import { createRoleEnrolmentRouter } from './role-enrolment.routes.js';
import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import {
  requireProvider,
  requireFleetOwner,
  requireFleetFinancialContext,
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
  router.use(createProviderAccountRouter(pool));
  router.get('/vehicle-catalog', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        data: await new PostgresFleetRepository(pool).catalog(_req.auth!.userId),
      });
    } catch (e) {
      next(e);
    }
  });
  router.use(createRoleEnrolmentRouter(repository.enrolment));
  router.use(createManagedDriverRouter(repository.managedDrivers));
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
  router.get('/onboarding', requireDriver(), async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repository.onboarding(req.auth!.userId, req.auth!.role),
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/onboarding', requireDriver(), async (req, res, next) => {
    try {
      const input = z
        .union([
          z.object({ defer: z.string().min(1).max(80) }).strict(),
          z.object({ resume: z.string().min(1).max(80) }).strict(),
        ])
        .parse(req.body);
      res.json({
        success: true,
        data: await repository.onboarding(req.auth!.userId, req.auth!.role, input),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/approval-requests', async (req, res, next) => {
    try {
      if (req.body?.requestType === 'fleet_submission') {
        z.object({ requestType: z.literal('fleet_submission') })
          .strict()
          .parse(req.body);
        res.json({
          success: true,
          data: await repository.submitFleetApprovals(req.auth!.userId, req.auth!.role),
        });
        return;
      }
      if (req.body?.requestType === 'onboarding_submission') {
        z.object({ requestType: z.literal('onboarding_submission') })
          .strict()
          .parse(req.body);
        res.json({
          success: true,
          data: await repository.onboarding(req.auth!.userId, req.auth!.role, { submit: true }),
        });
        return;
      }
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
  router.patch('/vehicles/:id/operation', requireProvider(), async (req, res, next) => {
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
  router.get('/earnings', requireFleetFinancialContext(), async (req, res, next) => {
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
  const fleetRequests = new FleetOwnerRequestsRepository(pool, repository);
  const ownerKey = z.union([z.string().regex(/^[1-9][0-9]{5,63}$/), z.string().uuid()]);
  const page = {
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  };
  router.get('/fleet-applications/:id/evidence', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        success: true,
        data: await fleetRequests.applicationEvidence(req.auth!.userId, id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/fleet-applications/:id/documents/:documentId/access-url', async (req, res, next) => {
    try {
      const query = z
        .object({ page: z.coerce.number().int().min(1).max(5).optional() })
        .strict()
        .parse(req.query);
      const document = await fleetRequests.applicationDocument(
        req.auth!.userId,
        z.string().uuid().parse(req.params.id),
        z.string().uuid().parse(req.params.documentId),
        query.page,
      );
      const accessUrl = await storageService.getAccessUrl({
        ...document,
        options: { expiresIn: 300 },
      });
      res.json({ success: true, data: { accessUrl, expiresIn: 300 } });
    } catch (error) {
      next(error);
    }
  });
  router.get('/fleet-owners', async (req, res, next) => {
    try {
      const query = z
        .object({ ...page, search: z.string().trim().max(100).default('') })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: await fleetRequests.owners(req.auth!.userId, query.search, query.limit, query.offset),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/fleet-owners/:key/requests', async (req, res, next) => {
    try {
      const query = z
        .object({
          ...page,
          category: z.enum(['all', ...fleetRequestCategories]).default('all'),
          status: z
            .enum(['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'])
            .default('ALL'),
          selectable: z
            .enum(['true', 'false'])
            .default('false')
            .transform((value) => value === 'true'),
        })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: await fleetRequests.requests(req.auth!.userId, ownerKey.parse(req.params.key), query),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/fleet-owners/:key/review', async (req, res, next) => {
    try {
      const input = z
        .object({
          status: z.enum(['APPROVED', 'REJECTED']),
          reason: z.string().trim().min(1).max(1000).optional(),
          items: z
            .array(
              z
                .object({
                  id: z.string().uuid(),
                  source: z.enum(['approval', 'application']),
                  expectedUpdatedAt: z.iso.datetime({ offset: true }),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict()
        .refine(
          (value) => value.status !== 'REJECTED' || !!value.reason,
          'Rejection reason is required',
        )
        .refine(
          (value) =>
            new Set(value.items.map(({ id, source }) => source + id)).size === value.items.length,
          'Duplicate selections',
        )
        .parse(req.body);
      res.json({
        success: true,
        data: await fleetRequests.review(
          req.auth!.userId,
          ownerKey.parse(req.params.key),
          input.status,
          input.reason,
          input.items,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/fleet-owners/:id/overview', async (req, res, next) => {
    try {
      const query = z
        .object({
          section: z
            .enum(['profile', 'documents', 'bank', 'vehicles', 'drivers', 'activity'])
            .default('profile'),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
          search: z.string().trim().max(100).default(''),
          status: z
            .enum([
              'ALL',
              'PENDING',
              'SUBMITTED',
              'APPROVED',
              'VERIFIED',
              'REJECTED',
              'EXPIRED',
              'CANCELLED',
              'ACTION_REQUIRED',
            ])
            .default('ALL'),
        })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: await new FleetOwnerOverviewRepository(pool).read(
          req.auth!.userId,
          z.string().uuid().parse(req.params.id),
          query.section,
          query.limit,
          query.offset,
          query.search,
          query.status,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
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
          requiredLicenceClasses: z
            .array(
              z
                .string()
                .trim()
                .toUpperCase()
                .regex(/^[A-Z0-9_-]{1,30}$/),
            )
            .max(20)
            .optional(),
          onboardingDeferrable: z.boolean().optional(),
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
      const query = z
        .object({
          status: z
            .enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ALL'])
            .default('PENDING'),
          group: z.literal('driver').optional(),
          kind: z.enum(['driver', 'vehicle']).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(10),
          search: z.string().max(200).default(''),
        })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: query.kind
          ? await repository.requestPage(req.auth!.userId, query.status, {
              kind: query.kind,
              page: query.page,
              pageSize: query.pageSize,
              search: query.search,
            })
          : await repository.pendingApprovals(
              req.auth!.userId,
              query.status,
              query.group === 'driver',
            ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id', async (req, res, next) => {
    try {
      const query = z
        .object({ group: z.literal('driver').optional() })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: await repository.approvalDetails(
          req.auth!.userId,
          z.string().uuid().parse(req.params.id),
          query.group === 'driver',
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
          expectedUpdatedAt: z.iso.datetime({ offset: true }),
          items: z
            .array(
              z
                .object({
                  id: z.string().uuid(),
                  expectedUpdatedAt: z.iso.datetime({ offset: true }),
                })
                .strict(),
            )
            .min(1)
            .max(100)
            .optional(),
        })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        data: await (input.items
          ? repository.reviewOnboarding(req.auth!.userId, z.string().uuid().parse(req.params.id), {
              status: input.status,
              reason: input.reason,
              items: input.items,
              expectedUpdatedAt: input.expectedUpdatedAt,
            })
          : repository.reviewApproval(
              req.auth!.userId,
              z.string().uuid().parse(req.params.id),
              input,
            )),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
