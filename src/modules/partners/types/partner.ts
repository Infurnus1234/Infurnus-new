export type PartnerApprovalStatus = 'pending' | 'under_review' | 'approved' | 'rejected';
export type PartnerAvailabilityStatus = 'offline' | 'available' | 'unavailable';

export interface Partner {
  id: string;
  userId: string;
  businessName: string;
  businessDescription: string | null;
  approvalStatus: PartnerApprovalStatus;
  availabilityStatus: PartnerAvailabilityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerData {
  userId: string;
  businessName: string;
  businessDescription?: string | undefined;
}

export interface UpdatePartnerData {
  businessName?: string | undefined;
  businessDescription?: string | null | undefined;
  availabilityStatus?: PartnerAvailabilityStatus | undefined;
}
