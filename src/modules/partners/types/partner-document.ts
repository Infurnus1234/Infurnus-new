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
  'OTHER',
] as const;

export type PartnerDocumentType = (typeof partnerDocumentTypes)[number];
export type PartnerDocumentStatus = 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface PartnerDocument {
  id: string;
  partnerId: string;
  vehicleId: string | null;
  documentType: PartnerDocumentType;
  status: PartnerDocumentStatus;
  issuedAt: string | null;
  expiresAt: string | null;
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
  metadata?: Record<string, unknown> | null | undefined;
  issuedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
}

export interface UpdatePartnerDocumentData {
  status?: PartnerDocumentStatus | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  issuedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
  verifiedAt?: Date | null | undefined;
}
