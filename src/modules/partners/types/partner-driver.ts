export type PartnerDriverStatus = 'ACTIVE' | 'INACTIVE';

export interface PartnerDriver {
  id: string;

  partnerId: string;
  driverProfileId: string;

  status: PartnerDriverStatus;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerDriverData {
  partnerId: string;
  driverProfileId: string;
}

export interface UpdatePartnerDriverStatusData {
  status: PartnerDriverStatus;
}
