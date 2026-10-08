import type {
  StorageAccessMode,
  StorageResourceType,
} from '../../../infrastructure/storage/types.js';

export const partnerDocumentTypes = [
  'AADHAAR',
  'PAN',
  'DRIVING_LICENCE',
  'PROFILE_PHOTO',
  'ADDRESS_PROOF',
  'VEHICLE_RC',
  'VEHICLE_INSURANCE',
  'VEHICLE_PERMIT',
  'VEHICLE_FITNESS',
  'VEHICLE_PUC',
  'OTHER',
] as const;

export type PartnerDocumentType = (typeof partnerDocumentTypes)[number];

export const partnerDocumentStatuses = [
  'PENDING',
  'SUBMITTED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const;

export type PartnerDocumentStatus = (typeof partnerDocumentStatuses)[number];

export interface PartnerDocumentStorageMetadata {
  storageProvider: 'cloudinary';
  storageKey: string;
  resourceType: StorageResourceType;
  accessMode: StorageAccessMode;
  mimeType: string;
  fileSize: number;
  originalFileName: string;
}

export interface PartnerDocumentMetadata {
  storage?: PartnerDocumentStorageMetadata | undefined;
  uploadedBy?: string | undefined;
  rejectionReason?: string | undefined;
  [key: string]: unknown;
}

export interface PartnerDocument {
  id: string;
  partnerId: string;
  vehicleId: string | null;
  documentType: PartnerDocumentType;
  status: PartnerDocumentStatus;
  metadata: PartnerDocumentMetadata | null;
  issuedAt: string | null;
  expiresAt: string | null;
  version?: number;
  uploadSource?: string;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  uploadedAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerDocumentData {
  partnerId: string;
  vehicleId?: string | null | undefined;
  documentType: PartnerDocumentType;
  status?: PartnerDocumentStatus | undefined;
  metadata?: PartnerDocumentMetadata | null | undefined;
  issuedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
}

export interface UpdatePartnerDocumentData {
  status?: PartnerDocumentStatus | undefined;
  metadata?: PartnerDocumentMetadata | null | undefined;
  issuedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
  verifiedAt?: Date | null | undefined;
  reviewedBy?: string | null | undefined;
  reviewedAt?: Date | null | undefined;
}
