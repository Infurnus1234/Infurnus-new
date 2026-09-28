import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';

import type { StorageFile } from './types.js';

const DEFAULT_MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

const DEFAULT_FIELD_NAME = 'file';

const storage = multer.memoryStorage();

export interface MultipartOptions {
  fieldName?: string;
  maxFileSizeBytes?: number;
  maxFiles?: number;
}

export interface UploadedStorageFile extends StorageFile {
  fieldName: string;
}

type StorageRequest = Request & {
  storageFile?: UploadedStorageFile;
  storageFiles?: UploadedStorageFile[];
};

function createMulter(options: MultipartOptions = {}): multer.Multer {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

  const maxFiles = options.maxFiles ?? 1;

  if (!Number.isInteger(maxFileSizeBytes) || maxFileSizeBytes <= 0) {
    throw new Error('maxFileSizeBytes must be a positive integer');
  }

  if (!Number.isInteger(maxFiles) || maxFiles <= 0) {
    throw new Error('maxFiles must be a positive integer');
  }

  return multer({
    storage,
    limits: {
      fileSize: maxFileSizeBytes,
      files: maxFiles,
      fields: 50,
      parts: maxFiles + 50,
    },
  });
}

function toStorageFile(file: Express.Multer.File): UploadedStorageFile {
  return {
    fieldName: file.fieldname,
    buffer: file.buffer,
    mimeType: file.mimetype,
    originalFileName: file.originalname,
    fileSize: file.size,
  };
}

export function uploadSingleFile(options: MultipartOptions = {}) {
  const fieldName = options.fieldName ?? DEFAULT_FIELD_NAME;

  return createMulter(options).single(fieldName);
}

export function uploadMultipleFiles(options: MultipartOptions = {}) {
  const fieldName = options.fieldName ?? DEFAULT_FIELD_NAME;

  return createMulter(options).array(fieldName, options.maxFiles ?? 10);
}

export function uploadFields(
  fields: multer.Field[],
  options: Omit<MultipartOptions, 'fieldName'> = {},
) {
  return createMulter(options).fields(fields);
}

export function normalizeSingleStorageFile(req: Request, _res: Response, next: NextFunction): void {
  const storageRequest = req as StorageRequest;

  if (!req.file) {
    next();
    return;
  }

  storageRequest.storageFile = toStorageFile(req.file);

  next();
}

export function normalizeMultipleStorageFiles(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const storageRequest = req as StorageRequest;

  if (!req.files) {
    next();
    return;
  }

  if (Array.isArray(req.files)) {
    storageRequest.storageFiles = req.files.map(toStorageFile);

    next();
    return;
  }

  const files = Object.values(req.files).flat().map(toStorageFile);

  storageRequest.storageFiles = files;

  next();
}

export function requireStorageFile(req: Request, _res: Response, next: NextFunction): void {
  const storageRequest = req as StorageRequest;

  if (!storageRequest.storageFile) {
    next(new Error('A file is required'));
    return;
  }

  next();
}

export function requireStorageFiles(req: Request, _res: Response, next: NextFunction): void {
  const storageRequest = req as StorageRequest;

  if (!storageRequest.storageFiles || storageRequest.storageFiles.length === 0) {
    next(new Error('At least one file is required'));
    return;
  }

  next();
}

export function createSingleFileUpload(options: MultipartOptions = {}) {
  return [uploadSingleFile(options), normalizeSingleStorageFile];
}

export function createMultipleFileUpload(options: MultipartOptions = {}) {
  return [uploadMultipleFiles(options), normalizeMultipleStorageFiles];
}

export function createRequiredSingleFileUpload(options: MultipartOptions = {}) {
  return [uploadSingleFile(options), normalizeSingleStorageFile, requireStorageFile];
}

export function createRequiredMultipleFileUpload(options: MultipartOptions = {}) {
  return [uploadMultipleFiles(options), normalizeMultipleStorageFiles, requireStorageFiles];
}

export function isMultipartRequest(req: Request): boolean {
  const contentType = req.headers['content-type'];

  if (!contentType) {
    return false;
  }

  return contentType.toLowerCase().startsWith('multipart/form-data');
}
