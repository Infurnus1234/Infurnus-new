import { Router } from 'express';
import { z } from 'zod';
import { emailSchema } from '../../auth/schemas/auth.schemas.js';
import { requireFleetOwner } from '../../auth/middleware/authorization.middleware.js';
import {
  upsertDriverProfileSchema,
  driverDocumentMetadataSchema,
} from '../../rides/schemas/driver.schemas.js';
import { DriverDocumentStorageService } from '../../rides/services/driver-document-storage.service.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import type { ManagedDriverRepository } from '../repositories/managed-driver.repository.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import {
  createRequiredSingleFileUpload,
  createRequiredMultipleFileUpload,
} from '../../../infrastructure/storage/multipart.js';
import { storageService } from '../../../infrastructure/storage/index.js';
import { AppError } from '../../../common/errors/app-error.js';

const createSchema = upsertDriverProfileSchema
  .extend({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    email: emailSchema,
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    driverUserId: z.string().uuid().optional(),
  })
  .strict();
const types = z.enum(['profile_photo', 'driver_license', 'vehicle_rc', 'identity', 'pan', 'other']);
export function createManagedDriverRouter(repo: ManagedDriverRepository) {
  const router = Router();
  const documents = new DriverDocumentStorageService({
    repository: new PostgresDriverDocumentRepository(pool),
  });
  router.use('/managed-drivers', requireFleetOwner());
  router.get('/managed-drivers', async (req, res, next) => {
    try {
      res.json({ success: true, data: await repo.list(req.auth!.userId, req.auth!.role) });
    } catch (e) {
      next(e);
    }
  });
  router.post('/managed-drivers', async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        data: await repo.create(req.auth!.userId, req.auth!.role, createSchema.parse(req.body)),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get('/managed-drivers/:id', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repo.detail(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.patch('/managed-drivers/:id/profile', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await repo.update(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
          upsertDriverProfileSchema.parse(req.body),
        ),
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/managed-drivers/:id/assignment', async (req, res, next) => {
    try {
      const { code } = z
        .object({
          code: z
            .string()
            .trim()
            .regex(/^\d{6}$/),
        })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        data: await repo.assign(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
          code,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.post('/managed-drivers/:id/submit', async (req, res, next) => {
    try {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      res.json({
        success: true,
        data: await repo.submit(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  router.get('/managed-drivers/:id/documents/:documentId/access-url', async (req, res, next) => {
    try {
      const doc = await repo.documentAccess(
        req.auth!.userId,
        req.auth!.role,
        z.string().uuid().parse(req.params.id),
        z.string().uuid().parse(req.params.documentId),
      );
      res.json({
        success: true,
        data: {
          accessUrl: await storageService.getAccessUrl({ ...doc, options: { expiresIn: 300 } }),
          expiresIn: 300,
        },
      });
    } catch (e) {
      next(e);
    }
  });
  router.post(
    '/managed-drivers/:id/documents/:type',
    ...createRequiredSingleFileUpload(),
    async (req, res, next) => {
      try {
        const target = await repo.authorizedProfile(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
        );
        if (!req.file) throw new AppError('FILE_REQUIRED', 'Choose a Driver document', 400);
        const meta = driverDocumentMetadataSchema.parse(req.body ?? {});
        const doc = await documents.upload({
          driverProfileId: target.id,
          documentType: types.parse(req.params.type),
          uploadedBy: req.auth!.userId,
          uploadSource: meta.uploadSource,
          documentMetadata: meta,
          file: {
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
            originalFileName: req.file.originalname,
            fileSize: req.file.size,
          },
        });
        res.status(201).json({
          success: true,
          data: {
            id: doc.id,
            documentType: doc.documentType,
            verificationStatus: doc.verificationStatus,
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );
  router.post(
    '/managed-drivers/:id/documents/:type/pages',
    ...createRequiredMultipleFileUpload({ fieldName: 'files', maxFiles: 5 }),
    async (req, res, next) => {
      try {
        const target = await repo.authorizedProfile(
          req.auth!.userId,
          req.auth!.role,
          z.string().uuid().parse(req.params.id),
        );
        const meta = driverDocumentMetadataSchema.parse(req.body ?? {});
        const files = Array.isArray(req.files) ? req.files : [];
        const doc = await documents.uploadPages({
          driverProfileId: target.id,
          documentType: types.parse(req.params.type),
          uploadedBy: req.auth!.userId,
          uploadSource: meta.uploadSource,
          documentMetadata: meta,
          files: files.map((f) => ({
            buffer: f.buffer,
            mimeType: f.mimetype,
            originalFileName: f.originalname,
            fileSize: f.size,
          })),
        });
        res.status(201).json({
          success: true,
          data: {
            id: doc.id,
            documentType: doc.documentType,
            verificationStatus: doc.verificationStatus,
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );
  return router;
}
