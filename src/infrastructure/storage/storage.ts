import type {
  StorageAccessUrlInput,
  StorageDeleteInput,
  StorageReplaceInput,
  StorageReplaceResult,
  StorageService,
  StorageUploadInput,
  StorageUploadResult,
} from './types.js';

export interface StorageProviderAdapter {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;

  delete(input: StorageDeleteInput): Promise<void>;

  getAccessUrl(input: StorageAccessUrlInput): Promise<string>;
}

export class DefaultStorageService implements StorageService {
  constructor(private readonly provider: StorageProviderAdapter) {}

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    return this.provider.upload(input);
  }

  async delete(input: StorageDeleteInput): Promise<void> {
    await this.provider.delete(input);
  }

  async getAccessUrl(input: StorageAccessUrlInput): Promise<string> {
    return this.provider.getAccessUrl(input);
  }

  async replace(input: StorageReplaceInput): Promise<StorageReplaceResult> {
    const uploaded = await this.provider.upload(input.newFile);

    try {
      await this.provider.delete(input.oldFile);
    } catch (error) {
      // The new file is already the valid replacement.
      // Old-file cleanup can be retried separately without
      // invalidating the newly uploaded file.
      void error;
    }

    return {
      uploaded,
      previousStorageKey: input.oldFile.storageKey,
    };
  }
}
