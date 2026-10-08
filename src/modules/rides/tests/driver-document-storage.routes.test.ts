import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../common/errors/app-error.js';
import { signAccessToken } from '../../auth/utils/jwt.js';

import { DriverController } from '../controllers/driver.controller.js';
import type { RideController } from '../controllers/ride.controller.js';
import { createRideRouter } from '../routes/ride.routes.js';

import type { DriverDocumentStorageService } from '../services/driver-document-storage.service.js';
import type { DriverService } from '../services/driver.service.js';
import type { RideService } from '../services/ride.service.js';

const driverUserId = '11111111-1111-1111-1111-111111111111';

const driverProfileId = '22222222-2222-2222-2222-222222222222';

const documentId = '33333333-3333-3333-3333-333333333333';

const customerUserId = '44444444-4444-4444-4444-444444444444';

const uploadedStorageKey = `infurnus/drivers/${driverProfileId}/documents/profile-photo/profile_photo-test.jpg`;

const driverDocument = {
  id: documentId,
  driverProfileId,
  documentType: 'profile_photo' as const,
  storageProvider: 'cloudinary',
  storageKey: uploadedStorageKey,
  resourceType: 'image' as const,
  accessMode: 'authenticated' as const,
  mimeType: 'image/jpeg',
  fileSize: 1024,
  verificationStatus: 'pending' as const,
  rejectionReason: null,
  uploadedBy: driverUserId,
  verifiedBy: null,
  verifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function createErrorMiddleware() {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    if (error instanceof Error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      },
    });
  };
}

async function createDriverToken(): Promise<string> {
  return signAccessToken({
    sub: driverUserId,
    role: 'driver',
    type: 'access',
  });
}

async function createCustomerToken(): Promise<string> {
  return signAccessToken({
    sub: customerUserId,
    role: 'customer',
    type: 'access',
  });
}

function createTestApp() {
  const driverService = {
    profileForUser: vi.fn(),
  } as unknown as DriverService;

  const rideService = {} as unknown as RideService;

  const driverDocumentStorageService = {
    upload: vi.fn(),
    listDocuments: vi.fn(),
    getDocument: vi.fn(),
    getAccessUrl: vi.fn(),
    delete: vi.fn(),
  } as unknown as DriverDocumentStorageService;

  const driverController = new DriverController(
    driverService,
    rideService,
    driverDocumentStorageService,
  );

  /*
   * createRideRouter also registers the normal ride routes.
   * Therefore all RideController handlers must exist,
   * even though these tests only exercise driver document routes.
   */
  const rideController = {
    map: vi.fn(),
    location: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    cancel: vi.fn(),
  } as unknown as RideController;

  const app = express();

  app.use(express.json());

  app.use('/rides', createRideRouter(rideController, driverController));

  app.use(createErrorMiddleware());

  return {
    app,
    driverService,
    driverDocumentStorageService,
  };
}

describe('Driver document storage routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  let driverService: ReturnType<typeof createTestApp>['driverService'];

  let driverDocumentStorageService: ReturnType<
    typeof createTestApp
  >['driverDocumentStorageService'];

  let driverToken: string;
  let customerToken: string;

  beforeEach(async () => {
    const testApp = createTestApp();

    app = testApp.app;
    driverService = testApp.driverService;
    driverDocumentStorageService = testApp.driverDocumentStorageService;

    driverToken = await createDriverToken();
    customerToken = await createCustomerToken();

    vi.clearAllMocks();

    vi.mocked(driverService.profileForUser).mockResolvedValue(driverProfileId);

    vi.mocked(driverDocumentStorageService.upload).mockResolvedValue(driverDocument);

    vi.mocked(driverDocumentStorageService.listDocuments).mockResolvedValue([driverDocument]);

    vi.mocked(driverDocumentStorageService.getDocument).mockResolvedValue(driverDocument);

    vi.mocked(driverDocumentStorageService.getAccessUrl).mockResolvedValue(
      'https://res.cloudinary.com/infurnus/profile-photo.jpg',
    );

    vi.mocked(driverDocumentStorageService.delete).mockResolvedValue(true);
  });

  // ==========================================================
  // Authentication
  // ==========================================================

  it('returns 401 when uploading without authentication', async () => {
    const response = await request(app)
      .post('/rides/driver/documents/profile_photo')
      .attach('file', Buffer.from('fake-profile-photo'), {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(401);

    expect(driverDocumentStorageService.upload).not.toHaveBeenCalled();
  });

  it('returns 403 when a non-driver tries to upload a driver document', async () => {
    const response = await request(app)
      .post('/rides/driver/documents/profile_photo')
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('file', Buffer.from('fake-profile-photo'), {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(403);

    expect(driverDocumentStorageService.upload).not.toHaveBeenCalled();
  });

  // ==========================================================
  // Upload
  // ==========================================================

  it('uploads a profile photo for an authenticated driver', async () => {
    const response = await request(app)
      .post('/rides/driver/documents/profile_photo')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', Buffer.from('fake-profile-photo'), {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: documentId,
          driverProfileId,
          documentType: 'profile_photo',
        }),
      }),
    );

    expect(driverService.profileForUser).toHaveBeenCalledWith(driverUserId);

    expect(driverDocumentStorageService.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        driverProfileId,
        documentType: 'profile_photo',
        uploadedBy: driverUserId,
        file: expect.objectContaining({
          mimeType: 'image/jpeg',
          originalFileName: 'profile.jpg',
        }),
      }),
    );
  });

  it('does not trust a client-supplied driver profile id', async () => {
    const maliciousProfileId = '99999999-9999-9999-9999-999999999999';

    const response = await request(app)
      .post(`/rides/driver/documents/profile_photo?driverProfileId=${maliciousProfileId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', Buffer.from('fake-profile-photo'), {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(201);

    expect(driverDocumentStorageService.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        driverProfileId,
      }),
    );

    expect(driverDocumentStorageService.upload).not.toHaveBeenCalledWith(
      expect.objectContaining({
        driverProfileId: maliciousProfileId,
      }),
    );
  });

  // ==========================================================
  // Document type validation
  // ==========================================================

  it('returns 400 for an invalid document type', async () => {
    const response = await request(app)
      .post('/rides/driver/documents/passport')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('file', Buffer.from('fake-document'), {
        filename: 'passport.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(400);

    expect(response.body.error?.code).toBe('INVALID_DRIVER_DOCUMENT_TYPE');

    expect(driverDocumentStorageService.upload).not.toHaveBeenCalled();
  });

  // ==========================================================
  // Missing file
  // ==========================================================

  it('rejects an upload without a file', async () => {
    const response = await request(app)
      .post('/rides/driver/documents/profile_photo')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(500);

    expect(driverDocumentStorageService.upload).not.toHaveBeenCalled();
  });

  // ==========================================================
  // List
  // ==========================================================

  it('lists documents for the authenticated driver', async () => {
    const response = await request(app)
      .get('/rides/driver/documents')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: [
          expect.objectContaining({
            id: documentId,
            driverProfileId,
            documentType: 'profile_photo',
          }),
        ],
      }),
    );

    expect(driverService.profileForUser).toHaveBeenCalledWith(driverUserId);

    expect(driverDocumentStorageService.listDocuments).toHaveBeenCalledWith(driverProfileId);
  });

  it('rejects document listing for non-driver users', async () => {
    const response = await request(app)
      .get('/rides/driver/documents')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(403);

    expect(driverDocumentStorageService.listDocuments).not.toHaveBeenCalled();
  });

  // ==========================================================
  // Get document
  // ==========================================================

  it('gets a single driver document', async () => {
    const response = await request(app)
      .get(`/rides/driver/documents/${documentId}`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: documentId,
          driverProfileId,
          documentType: 'profile_photo',
        }),
      }),
    );

    expect(driverDocumentStorageService.getDocument).toHaveBeenCalledWith(
      driverProfileId,
      documentId,
    );
  });

  it('returns 404 when the requested document does not exist', async () => {
    vi.mocked(driverDocumentStorageService.getDocument).mockResolvedValue(null);

    const response = await request(app)
      .get(`/rides/driver/documents/${documentId}`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(404);

    expect(response.body.error?.code).toBe('DRIVER_DOCUMENT_NOT_FOUND');
  });

  // ==========================================================
  // Access URL
  // ==========================================================

  it('generates a document access URL', async () => {
    const response = await request(app)
      .get(`/rides/driver/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: {
          accessUrl: 'https://res.cloudinary.com/infurnus/profile-photo.jpg',
          expiresIn: 300,
        },
      }),
    );

    expect(driverDocumentStorageService.getAccessUrl).toHaveBeenCalledWith(
      driverProfileId,
      documentId,
    );
  });

  it('returns 404 when access URL cannot be generated', async () => {
    vi.mocked(driverDocumentStorageService.getAccessUrl).mockResolvedValue(null);

    const response = await request(app)
      .get(`/rides/driver/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(404);

    expect(response.body.error?.code).toBe('DRIVER_DOCUMENT_NOT_FOUND');
  });

  // ==========================================================
  // Delete
  // ==========================================================

  it('deletes a driver document', async () => {
    const response = await request(app)
      .delete(`/rides/driver/documents/${documentId}`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        message: 'Driver document deleted successfully',
      }),
    );

    expect(driverDocumentStorageService.delete).toHaveBeenCalledWith(driverProfileId, documentId);
  });

  it('returns 404 when deleting a document that does not exist', async () => {
    vi.mocked(driverDocumentStorageService.delete).mockResolvedValue(false);

    const response = await request(app)
      .delete(`/rides/driver/documents/${documentId}`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(response.status).toBe(404);

    expect(response.body.error?.code).toBe('DRIVER_DOCUMENT_NOT_FOUND');
  });

  it('rejects document deletion for non-driver users', async () => {
    const response = await request(app)
      .delete(`/rides/driver/documents/${documentId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(403);

    expect(driverDocumentStorageService.delete).not.toHaveBeenCalled();
  });
});
