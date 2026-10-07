import { describe, expect, it } from 'vitest';

import {
  getStorageAccessMode,
  getStoragePolicy,
  getStorageResourceType,
  isPrivateDocumentCategory,
  StorageValidationError,
  validateStorageFile,
} from './validation.js';

function createPdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'ascii');
}

function createJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
}

function createPngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function createWebpBuffer(): Buffer {
  return Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
}

describe('storage validation', () => {
  it('accepts a valid partner Aadhaar PDF', () => {
    const buffer = createPdfBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'application/pdf',
          originalFileName: 'document.pdf',
          fileSize: buffer.length,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'authenticated',
          resourceType: 'raw',
        },
      ),
    ).not.toThrow();
  });

  it('accepts a valid profile photo image', () => {
    const buffer = createJpegBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'image/jpeg',
          originalFileName: 'profile.jpg',
          fileSize: buffer.length,
        },
        {
          category: 'profile-photo',
          accessMode: 'public',
          resourceType: 'image',
        },
      ),
    ).not.toThrow();
  });

  it('accepts a valid PNG profile photo', () => {
    const buffer = createPngBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'image/png',
          originalFileName: 'profile.png',
          fileSize: buffer.length,
        },
        {
          category: 'profile-photo',
          accessMode: 'public',
          resourceType: 'image',
        },
      ),
    ).not.toThrow();
  });

  it('accepts a valid WebP profile photo', () => {
    const buffer = createWebpBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'image/webp',
          originalFileName: 'profile.webp',
          fileSize: buffer.length,
        },
        {
          category: 'profile-photo',
          accessMode: 'public',
          resourceType: 'image',
        },
      ),
    ).not.toThrow();
  });

  it('rejects an unsupported MIME type', () => {
    const buffer = Buffer.from('test-file');

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'text/plain',
          originalFileName: 'document.txt',
          fileSize: buffer.length,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'authenticated',
          resourceType: 'raw',
        },
      ),
    ).toThrowError(StorageValidationError);

    try {
      validateStorageFile(
        {
          buffer,
          mimeType: 'text/plain',
          originalFileName: 'document.txt',
          fileSize: buffer.length,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'authenticated',
          resourceType: 'raw',
        },
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_MIME_TYPE',
      });
    }
  });

  it('rejects MIME type and extension mismatch', () => {
    const buffer = createPdfBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'application/pdf',
          originalFileName: 'document.jpg',
          fileSize: buffer.length,
        },
        {
          category: 'other',
          accessMode: 'authenticated',
          resourceType: 'raw',
        },
      ),
    ).toThrowError('File extension .jpg does not match MIME type application/pdf');
  });

  it('rejects an oversized image', () => {
    const buffer = Buffer.alloc(10 * 1024 * 1024 + 1, 0);

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'image/jpeg',
          originalFileName: 'profile.jpg',
          fileSize: buffer.length,
        },
        {
          category: 'profile-photo',
          accessMode: 'public',
          resourceType: 'image',
        },
      ),
    ).toThrowError('File size must not exceed 10 MB');
  });

  it('rejects an oversized document', () => {
    const buffer = Buffer.alloc(15 * 1024 * 1024 + 1, 0);

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'application/pdf',
          originalFileName: 'document.pdf',
          fileSize: buffer.length,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'authenticated',
          resourceType: 'raw',
        },
      ),
    ).toThrowError('File size must not exceed 15 MB');
  });

  it('rejects an empty file', () => {
    const buffer = Buffer.alloc(0);

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'application/pdf',
          originalFileName: 'document.pdf',
          fileSize: 0,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'authenticated',
          resourceType: 'raw',
        },
      ),
    ).toThrowError('File size must be a positive integer');
  });

  it('rejects an invalid filename', () => {
    const buffer = createPdfBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'application/pdf',
          originalFileName: '../document.pdf',
          fileSize: buffer.length,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'authenticated',
          resourceType: 'raw',
        },
      ),
    ).toThrowError('File name contains invalid characters');
  });

  it('rejects incorrect access mode', () => {
    const buffer = createPdfBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'application/pdf',
          originalFileName: 'document.pdf',
          fileSize: buffer.length,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'public',
          resourceType: 'raw',
        },
      ),
    ).toThrowError('partner-aadhaar must use authenticated storage access');
  });

  it('rejects incorrect resource type', () => {
    const buffer = createPdfBuffer();

    expect(() =>
      validateStorageFile(
        {
          buffer,
          mimeType: 'application/pdf',
          originalFileName: 'document.pdf',
          fileSize: buffer.length,
        },
        {
          category: 'partner-aadhaar',
          accessMode: 'authenticated',
          resourceType: 'image',
        },
      ),
    ).toThrowError('Resource type must be raw for this document category');
  });

  it('returns authenticated access for private partner documents', () => {
    expect(getStorageAccessMode('partner-aadhaar')).toBe('authenticated');
  });

  it('returns public access for profile photos', () => {
    expect(getStorageAccessMode('profile-photo')).toBe('public');
  });

  it('identifies private document categories', () => {
    expect(isPrivateDocumentCategory('partner-aadhaar')).toBe(true);

    expect(isPrivateDocumentCategory('partner-pan')).toBe(true);

    expect(isPrivateDocumentCategory('profile-photo')).toBe(false);
  });

  it('returns image resource type for profile photos', () => {
    expect(getStorageResourceType('profile-photo')).toBe('image');
  });

  it('returns raw resource type for documents', () => {
    expect(getStorageResourceType('partner-aadhaar')).toBe('raw');
  });

  it('returns the expected policy for profile photos', () => {
    const policy = getStoragePolicy('profile-photo');

    expect(policy).toEqual({
      resourceType: 'image',
      accessMode: 'public',
      maxSizeBytes: 10 * 1024 * 1024,
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      extensions: ['jpg', 'jpeg', 'png', 'webp'],
    });
  });

  it('returns the expected policy for sensitive documents', () => {
    const policy = getStoragePolicy('partner-aadhaar');

    expect(policy).toEqual({
      resourceType: 'raw',
      accessMode: 'authenticated',
      maxSizeBytes: 15 * 1024 * 1024,
      mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    });
  });

  describe('magic-byte validation', () => {
    it('rejects JPEG content with a fake JPEG MIME type', () => {
      const buffer = Buffer.from('this-is-not-a-jpeg');

      expect(() =>
        validateStorageFile(
          {
            buffer,
            mimeType: 'image/jpeg',
            originalFileName: 'profile.jpg',
            fileSize: buffer.length,
          },
          {
            category: 'profile-photo',
            accessMode: 'public',
            resourceType: 'image',
          },
        ),
      ).toThrowError('File content does not match image/jpeg');
    });

    it('rejects PNG content with a fake PNG MIME type', () => {
      const buffer = Buffer.from('this-is-not-a-png');

      expect(() =>
        validateStorageFile(
          {
            buffer,
            mimeType: 'image/png',
            originalFileName: 'profile.png',
            fileSize: buffer.length,
          },
          {
            category: 'profile-photo',
            accessMode: 'public',
            resourceType: 'image',
          },
        ),
      ).toThrowError('File content does not match image/png');
    });

    it('rejects WebP content with a fake WebP MIME type', () => {
      const buffer = Buffer.from('this-is-not-a-webp');

      expect(() =>
        validateStorageFile(
          {
            buffer,
            mimeType: 'image/webp',
            originalFileName: 'profile.webp',
            fileSize: buffer.length,
          },
          {
            category: 'profile-photo',
            accessMode: 'public',
            resourceType: 'image',
          },
        ),
      ).toThrowError('File content does not match image/webp');
    });

    it('rejects PDF content with a fake PDF MIME type', () => {
      const buffer = Buffer.from('this-is-not-a-pdf');

      expect(() =>
        validateStorageFile(
          {
            buffer,
            mimeType: 'application/pdf',
            originalFileName: 'document.pdf',
            fileSize: buffer.length,
          },
          {
            category: 'partner-aadhaar',
            accessMode: 'authenticated',
            resourceType: 'raw',
          },
        ),
      ).toThrowError('File content does not match application/pdf');
    });

    it('rejects a valid image extension when the actual content is a PDF', () => {
      const buffer = createPdfBuffer();

      expect(() =>
        validateStorageFile(
          {
            buffer,
            mimeType: 'image/jpeg',
            originalFileName: 'profile.jpg',
            fileSize: buffer.length,
          },
          {
            category: 'profile-photo',
            accessMode: 'public',
            resourceType: 'image',
          },
        ),
      ).toThrowError('File content does not match image/jpeg');
    });

    it('rejects a valid PDF extension when the actual content is an image', () => {
      const buffer = createJpegBuffer();

      expect(() =>
        validateStorageFile(
          {
            buffer,
            mimeType: 'application/pdf',
            originalFileName: 'document.pdf',
            fileSize: buffer.length,
          },
          {
            category: 'partner-aadhaar',
            accessMode: 'authenticated',
            resourceType: 'raw',
          },
        ),
      ).toThrowError('File content does not match application/pdf');
    });
  });
});
