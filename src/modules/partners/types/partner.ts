export type PartnerApprovalStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

export type PartnerAvailabilityStatus = 'offline' | 'available' | 'unavailable';

export interface Partner {
  id: string;
  userId: string;

  businessName: string;
  businessType?: string | null | undefined;
  gstNumber?: string | null | undefined;
  businessDescription: string | null;

  ownerName?: string | null;
  providerType?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  numberOfVehicles?: number | null;

  approvalStatus: PartnerApprovalStatus;
  availabilityStatus: PartnerAvailabilityStatus;

  reviewedAt: Date | null;
  reviewedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerData {
  userId: string;
  businessName: string;
  businessType?: string | null | undefined;
  gstNumber?: string | null | undefined;
  businessDescription?: string | undefined;

  ownerName?: string | undefined;
  providerType?: string | undefined;
  address?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  pinCode?: string | undefined;
  numberOfVehicles?: number | undefined;
}

export interface UpdatePartnerData {
  businessName?: string | undefined;
  businessType?: string | null | undefined;
  gstNumber?: string | null | undefined;
  businessDescription?: string | null | undefined;

  ownerName?: string | null | undefined;
  providerType?: string | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  pinCode?: string | null | undefined;
  numberOfVehicles?: number | null | undefined;

  availabilityStatus?: PartnerAvailabilityStatus | undefined;
}

export interface ReviewPartnerData {
  status: 'approved' | 'rejected' | 'under_review';
  reason?: string | undefined;
}
