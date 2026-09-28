import type { StorageAccessMode, StorageResourceType, StorageFile } from './types.js';

export type StorageDocumentCategory =
  | 'profile-photo'
  | 'owner-aadhaar'
  | 'owner-pan'
  | 'owner-address-proof'
  | 'driver-license'
  | 'driver-profile-photo'
  | 'vehicle-rc'
  | 'vehicle-insurance'
  | 'vehicle-permit'
  | 'vehicle-fitness'
  | 'vehicle-photo'
  | 'partner-profile-photo'
  | 'partner-aadhaar'
  | 'partner-pan'
  | 'partner-address-proof'
  | 'partner-document'
  | 'other';

export interface StorageValidationOptions {
  category: StorageDocumentCategory;
  accessMode: StorageAccessMode;
  resourceType?: StorageResourceType | undefined;
}

interface FilePolicy {
  resourceType: StorageResourceType;
  accessMode: StorageAccessMode;
  maxSizeBytes: number;
  mimeTypes: readonly string[];
  extensions: readonly string[];
}

export class StorageValidationError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageValidationError';
    this.code = code;
  }
}

const MB = 1024 * 1024;

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

const DOCUMENT_EXTENSIONS = ['pdf'] as const;

const IMAGE_MAX_SIZE = 10 * MB;
const DOCUMENT_MAX_SIZE = 15 * MB;

const PRIVATE_DOCUMENT_CATEGORIES: readonly StorageDocumentCategory[] = [
  'owner-aadhaar',
  'owner-pan',
  'owner-address-proof',
  'driver-license',
  'vehicle-rc',
  'vehicle-insurance',
  'vehicle-permit',
  'vehicle-fitness',
  'partner-aadhaar',
  'partner-pan',
  'partner-address-proof',
  'partner-document',
];

const CATEGORY_POLICIES: Record<StorageDocumentCategory, FilePolicy> = {
  'profile-photo': {
    resourceType: 'image',
    accessMode: 'public',
    maxSizeBytes: IMAGE_MAX_SIZE,
    mimeTypes: IMAGE_MIME_TYPES,
    extensions: IMAGE_EXTENSIONS,
  },

  'driver-profile-photo': {
    resourceType: 'image',
    accessMode: 'public',
    maxSizeBytes: IMAGE_MAX_SIZE,
    mimeTypes: IMAGE_MIME_TYPES,
    extensions: IMAGE_EXTENSIONS,
  },

  'vehicle-photo': {
    resourceType: 'image',
    accessMode: 'public',
    maxSizeBytes: IMAGE_MAX_SIZE,
    mimeTypes: IMAGE_MIME_TYPES,
    extensions: IMAGE_EXTENSIONS,
  },

  'partner-profile-photo': {
    resourceType: 'image',
    accessMode: 'public',
    maxSizeBytes: IMAGE_MAX_SIZE,
    mimeTypes: IMAGE_MIME_TYPES,
    extensions: IMAGE_EXTENSIONS,
  },

  'owner-aadhaar': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'owner-pan': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'owner-address-proof': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'driver-license': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'vehicle-rc': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'vehicle-insurance': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'vehicle-permit': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'vehicle-fitness': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'partner-aadhaar': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'partner-pan': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'partner-address-proof': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  'partner-document': {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: DOCUMENT_MIME_TYPES,
    extensions: DOCUMENT_EXTENSIONS,
  },

  other: {
    resourceType: 'raw',
    accessMode: 'authenticated',
    maxSizeBytes: DOCUMENT_MAX_SIZE,
    mimeTypes: [...DOCUMENT_MIME_TYPES, ...IMAGE_MIME_TYPES],
    extensions: [...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS],
  },
};

function getExtension(fileName: string): string {
  const normalizedName = fileName.trim().toLowerCase();

  const lastDot = normalizedName.lastIndexOf('.');

  if (lastDot === -1 || lastDot === normalizedName.length - 1) {
    return '';
  }

  return normalizedName.slice(lastDot + 1);
}

function getPolicy(category: StorageDocumentCategory): FilePolicy {
  const policy = CATEGORY_POLICIES[category];

  if (!policy) {
    throw new StorageValidationError(
      'UNSUPPORTED_DOCUMENT_CATEGORY',
      `Unsupported storage document category: ${category}`,
    );
  }

  return policy;
}

function validateFileName(fileName: string): void {
  const normalizedName = fileName.trim();

  if (!normalizedName) {
    throw new StorageValidationError('INVALID_FILE_NAME', 'File name is required');
  }

  if (normalizedName.length > 255) {
    throw new StorageValidationError(
      'FILE_NAME_TOO_LONG',
      'File name must not exceed 255 characters',
    );
  }

  if (
    normalizedName.includes('\0') ||
    normalizedName.includes('/') ||
    normalizedName.includes('\\')
  ) {
    throw new StorageValidationError('INVALID_FILE_NAME', 'File name contains invalid characters');
  }
}

function validateFileSize(file: StorageFile, policy: FilePolicy): void {
  if (!Number.isInteger(file.fileSize) || file.fileSize <= 0) {
    throw new StorageValidationError('INVALID_FILE_SIZE', 'File size must be a positive integer');
  }

  if (file.fileSize > policy.maxSizeBytes) {
    const maxSizeMb = policy.maxSizeBytes / MB;

    throw new StorageValidationError('FILE_TOO_LARGE', `File size must not exceed ${maxSizeMb} MB`);
  }

  if (file.buffer.length !== file.fileSize) {
    throw new StorageValidationError(
      'FILE_SIZE_MISMATCH',
      'Provided file size does not match the file buffer',
    );
  }
}

function validateMimeType(file: StorageFile, policy: FilePolicy): void {
  const mimeType = file.mimeType.trim().toLowerCase();

  if (!mimeType) {
    throw new StorageValidationError('MISSING_MIME_TYPE', 'File MIME type is required');
  }

  if (!policy.mimeTypes.includes(mimeType)) {
    throw new StorageValidationError(
      'UNSUPPORTED_MIME_TYPE',
      `MIME type ${mimeType} is not allowed for this document category`,
    );
  }
}

function validateExtension(file: StorageFile, policy: FilePolicy): void {
  const extension = getExtension(file.originalFileName);

  if (!extension) {
    throw new StorageValidationError('MISSING_FILE_EXTENSION', 'File extension is required');
  }

  if (!policy.extensions.includes(extension)) {
    throw new StorageValidationError(
      'UNSUPPORTED_FILE_EXTENSION',
      `File extension .${extension} is not allowed for this document category`,
    );
  }
}

function validateMimeExtensionConsistency(file: StorageFile): void {
  const extension = getExtension(file.originalFileName);

  const mimeType = file.mimeType.trim().toLowerCase();

  const imageExtensions = new Set<string>(IMAGE_EXTENSIONS);

  const documentExtensions = new Set<string>(DOCUMENT_EXTENSIONS);

  if (
    imageExtensions.has(extension) &&
    !IMAGE_MIME_TYPES.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number])
  ) {
    throw new StorageValidationError(
      'MIME_EXTENSION_MISMATCH',
      `File extension .${extension} does not match MIME type ${mimeType}`,
    );
  }

  if (
    documentExtensions.has(extension) &&
    !DOCUMENT_MIME_TYPES.includes(mimeType as (typeof DOCUMENT_MIME_TYPES)[number])
  ) {
    throw new StorageValidationError(
      'MIME_EXTENSION_MISMATCH',
      `File extension .${extension} does not match MIME type ${mimeType}`,
    );
  }
}

function validateFileContent(file: StorageFile): void {
  const mimeType = file.mimeType.trim().toLowerCase();

  switch (mimeType) {
    case 'image/jpeg':
      if (!isJpeg(file.buffer)) {
        throw new StorageValidationError(
          'FILE_CONTENT_MISMATCH',
          'File content does not match image/jpeg',
        );
      }
      break;

    case 'image/png':
      if (!isPng(file.buffer)) {
        throw new StorageValidationError(
          'FILE_CONTENT_MISMATCH',
          'File content does not match image/png',
        );
      }
      break;

    case 'image/webp':
      if (!isWebp(file.buffer)) {
        throw new StorageValidationError(
          'FILE_CONTENT_MISMATCH',
          'File content does not match image/webp',
        );
      }
      break;

    case 'application/pdf':
      if (!isPdf(file.buffer)) {
        throw new StorageValidationError(
          'FILE_CONTENT_MISMATCH',
          'File content does not match application/pdf',
        );
      }
      break;

    default:
      throw new StorageValidationError(
        'UNSUPPORTED_MIME_TYPE',
        `MIME type ${mimeType} is not supported for content validation`,
      );
  }
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-';
}

function validateAccessMode(
  category: StorageDocumentCategory,
  accessMode: StorageAccessMode,
): void {
  const isPrivateCategory = PRIVATE_DOCUMENT_CATEGORIES.includes(category);

  if (isPrivateCategory && accessMode !== 'authenticated') {
    throw new StorageValidationError(
      'INVALID_ACCESS_MODE',
      `${category} must use authenticated storage access`,
    );
  }
}

function validateResourceType(
  policy: FilePolicy,
  resourceType: StorageResourceType | undefined,
): void {
  if (resourceType !== undefined && resourceType !== policy.resourceType) {
    throw new StorageValidationError(
      'INVALID_RESOURCE_TYPE',
      `Resource type must be ${policy.resourceType} for this document category`,
    );
  }
}

export function validateStorageFile(file: StorageFile, options: StorageValidationOptions): void {
  if (!file) {
    throw new StorageValidationError('FILE_REQUIRED', 'File is required');
  }

  validateFileName(file.originalFileName);

  const policy = getPolicy(options.category);

  validateFileSize(file, policy);

  validateMimeType(file, policy);

  validateExtension(file, policy);

  validateMimeExtensionConsistency(file);

  validateFileContent(file);

  validateAccessMode(options.category, options.accessMode);

  validateResourceType(policy, options.resourceType);
}

export function getStoragePolicy(category: StorageDocumentCategory): Readonly<FilePolicy> {
  return getPolicy(category);
}

export function isPrivateDocumentCategory(category: StorageDocumentCategory): boolean {
  return PRIVATE_DOCUMENT_CATEGORIES.includes(category);
}

export function getStorageResourceType(category: StorageDocumentCategory): StorageResourceType {
  return getPolicy(category).resourceType;
}

export function getStorageAccessMode(category: StorageDocumentCategory): StorageAccessMode {
  return getPolicy(category).accessMode;
}
