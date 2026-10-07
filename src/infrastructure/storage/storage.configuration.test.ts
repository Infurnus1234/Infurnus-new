import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { storageService } from './index.js';

const cloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

describe('optional Cloudinary configuration', () => {
  it.skipIf(cloudinaryConfigured)(
    'allows backend modules to load but reports a clear error when storage is used',
    async () => {
      await expect(
        storageService.upload({
          file: {
            buffer: Buffer.from('test'),
            mimeType: 'text/plain',
            originalFileName: 'test.txt',
            fileSize: 4,
          },
          folder: 'tests',
          resourceType: 'raw',
          accessMode: 'authenticated',
        }),
      ).rejects.toThrow(/Cloudinary storage is unavailable.*CLOUDINARY_CLOUD_NAME/);
    },
  );
});
