import { DefaultStorageService } from './storage.js';
import { CloudinaryStorageProvider } from './cloudinary.js';
import { env } from '../../config/env.js';
import type { StorageAccessUrlInput, StorageDeleteInput, StorageUploadInput } from './types.js';
import type { StorageProviderAdapter } from './storage.js';

const cloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);
let configuredProvider: CloudinaryStorageProvider | undefined;

function getConfiguredProvider(): CloudinaryStorageProvider {
  if (!cloudinaryConfigured) {
    throw new Error(
      'Cloudinary storage is unavailable. Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to use file storage.',
    );
  }

  configuredProvider ??= new CloudinaryStorageProvider();
  return configuredProvider;
}

const storageProvider: StorageProviderAdapter = {
  upload(input: StorageUploadInput) {
    return getConfiguredProvider().upload(input);
  },
  delete(input: StorageDeleteInput) {
    return getConfiguredProvider().delete(input);
  },
  getAccessUrl(input: StorageAccessUrlInput) {
    return getConfiguredProvider().getAccessUrl(input);
  },
};

export const storageService = new DefaultStorageService(storageProvider);

export { DefaultStorageService } from './storage.js';
export { CloudinaryStorageProvider } from './cloudinary.js';

export type {
  StorageAccessMode,
  StorageAccessUrlInput,
  StorageAccessUrlOptions,
  StorageDeleteInput,
  StorageFile,
  StorageProvider,
  StorageReplaceInput,
  StorageReplaceResult,
  StorageResourceType,
  StorageService,
  StorageUploadInput,
  StorageUploadResult,
} from './types.js';
