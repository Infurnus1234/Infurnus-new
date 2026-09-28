import type { Buffer } from 'node:buffer';

export type StorageProvider = 'cloudinary';

export type StorageResourceType = 'image' | 'raw' | 'auto';

export type StorageAccessMode = 'public' | 'authenticated';

export interface StorageFile {
  buffer: Buffer;
  mimeType: string;
  originalFileName: string;
  fileSize: number;
}

export interface StorageUploadInput {
  file: StorageFile;
  folder: string;
  resourceType: StorageResourceType;
  accessMode: StorageAccessMode;
  storageKey?: string | undefined;
}

export interface StorageUploadResult {
  storageProvider: StorageProvider;
  storageKey: string;
  resourceType: StorageResourceType;
  accessMode: StorageAccessMode;
  mimeType: string;
  fileSize: number;
}

export interface StorageDeleteInput {
  storageKey: string;
  resourceType: StorageResourceType;
  accessMode: StorageAccessMode;
}

export interface StorageAccessUrlOptions {
  expiresIn?: number | undefined;
}

export interface StorageAccessUrlInput {
  storageKey: string;
  resourceType: StorageResourceType;
  accessMode: StorageAccessMode;
  options?: StorageAccessUrlOptions | undefined;
}

export interface StorageReplaceInput {
  oldFile: StorageDeleteInput;
  newFile: StorageUploadInput;
}

export interface StorageReplaceResult {
  uploaded: StorageUploadResult;
  previousStorageKey: string;
}

export interface StorageService {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;

  delete(input: StorageDeleteInput): Promise<void>;

  getAccessUrl(input: StorageAccessUrlInput): Promise<string>;

  replace(input: StorageReplaceInput): Promise<StorageReplaceResult>;
}
