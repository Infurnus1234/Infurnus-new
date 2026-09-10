export const rentalStatuses = ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

export type RentalStatus = (typeof rentalStatuses)[number];

export interface Rental {
  id: string;
  userId: string;
  vehicleId: string;
  startAt: Date;
  endAt: Date;
  status: RentalStatus;
  totalAmount: number;
  currency: string;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
}
