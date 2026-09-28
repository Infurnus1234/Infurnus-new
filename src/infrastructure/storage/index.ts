import { DefaultStorageService } from './storage.js';
import { CloudinaryStorageProvider } from './cloudinary.js';

const storageProvider = new CloudinaryStorageProvider();

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
