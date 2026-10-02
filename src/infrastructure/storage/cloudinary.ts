import { Readable } from 'node:stream';

import { v2 as cloudinary } from 'cloudinary';

import { env } from '../../config/env.js';
import type {
  StorageAccessUrlInput,
  StorageDeleteInput,
  StorageResourceType,
  StorageUploadInput,
  StorageUploadResult,
} from './types.js';
import type { StorageProviderAdapter } from './storage.js';

type CloudinaryResourceType = 'image' | 'raw';

type CloudinaryDeliveryType = 'upload' | 'authenticated';

interface CloudinaryUploadResult {
  public_id: string;
  resource_type: string;
  type: string;
  format?: string;
  bytes: number;
  secure_url?: string;
}

function isCloudinaryResourceType(value: string): value is CloudinaryResourceType {
  return value === 'image' || value === 'raw';
}

function mapResourceType(resourceType: StorageResourceType): CloudinaryResourceType {
  if (resourceType === 'auto') {
    return 'raw';
  }

  return resourceType;
}

function mapAccessMode(accessMode: StorageUploadInput['accessMode']): CloudinaryDeliveryType {
  return accessMode === 'authenticated' ? 'authenticated' : 'upload';
}

function getCloudinaryErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  return 'Cloudinary operation failed';
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');

  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return '';
  }

  return fileName.slice(lastDot + 1).toLowerCase();
}

function normalizeStorageKey(
  folder: string,
  storageKey: string | undefined,
  fileName: string,
  resourceType: CloudinaryResourceType,
): string {
  const normalizedFolder = folder.trim().replace(/^\/+|\/+$/g, '');

  if (storageKey) {
    return storageKey.trim().replace(/^\/+|\/+$/g, '');
  }

  const safeFileName = fileName
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const generatedName = safeFileName.length > 0 ? safeFileName : `asset-${Date.now()}`;

  if (resourceType === 'raw') {
    const extension = getFileExtension(fileName);

    return extension
      ? `${normalizedFolder}/${generatedName}.${extension}`
      : `${normalizedFolder}/${generatedName}`;
  }

  return `${normalizedFolder}/${generatedName}`;
}

function createUploadOptions(
  input: StorageUploadInput,
  resourceType: CloudinaryResourceType,
): Record<string, unknown> {
  const publicId = normalizeStorageKey(
    input.folder,
    input.storageKey,
    input.file.originalFileName,
    resourceType,
  );

  return {
    public_id: publicId,
    resource_type: resourceType,
    type: mapAccessMode(input.accessMode),
    overwrite: false,
    unique_filename: false,
    use_filename: false,
  };
}

function uploadBuffer(
  buffer: Buffer,
  options: Record<string, unknown>,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error: unknown, result: CloudinaryUploadResult | undefined) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result) {
          reject(new Error('Cloudinary upload completed without a result'));
          return;
        }

        resolve(result);
      },
    );

    Readable.from(buffer).pipe(uploadStream);
  });
}

export class CloudinaryStorageProvider implements StorageProviderAdapter {
  constructor() {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      throw new Error(
        'Cloudinary storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
      );
    }

    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const resourceType = mapResourceType(input.resourceType);

    try {
      const options = createUploadOptions(input, resourceType);

      const result = await uploadBuffer(input.file.buffer, options);

      if (!isCloudinaryResourceType(result.resource_type)) {
        throw new Error(`Unsupported Cloudinary resource type: ${result.resource_type}`);
      }

      return {
        storageProvider: 'cloudinary',
        storageKey: result.public_id,
        resourceType: result.resource_type,
        accessMode: result.type === 'authenticated' ? 'authenticated' : 'public',
        mimeType: input.file.mimeType,
        fileSize: result.bytes,
      };
    } catch (error) {
      throw new Error(`Cloudinary upload failed: ${getCloudinaryErrorMessage(error)}`);
    }
  }

  async delete(input: StorageDeleteInput): Promise<void> {
    const resourceType = input.resourceType === 'auto' ? 'raw' : input.resourceType;

    try {
      await cloudinary.uploader.destroy(input.storageKey, {
        resource_type: resourceType,
        type: mapAccessMode(input.accessMode),
        invalidate: true,
      });
    } catch (error) {
      throw new Error(`Cloudinary delete failed: ${getCloudinaryErrorMessage(error)}`);
    }
  }

  async getAccessUrl(input: StorageAccessUrlInput): Promise<string> {
    const resourceType = input.resourceType === 'auto' ? 'raw' : input.resourceType;

    if (input.accessMode === 'public') {
      return cloudinary.url(input.storageKey, {
        secure: true,
        resource_type: resourceType,
        type: 'upload',
      });
    }

    const expiresIn = input.options?.expiresIn ?? 3600;

    if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
      throw new Error('expiresIn must be a positive integer');
    }

    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    const extension = getFileExtension(input.storageKey);

    if (!extension) {
      throw new Error('A file extension is required to generate a secure Cloudinary access URL');
    }

    return cloudinary.utils.private_download_url(input.storageKey, extension, {
      resource_type: resourceType,
      type: 'authenticated',
      expires_at: expiresAt,
    });
  }
}
