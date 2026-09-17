export interface Rating {
  id: string;
  rideId: string;
  customerId: string;
  driverProfileId: string;
  rating: number;
  review: string | null;
  createdAt: Date;
}

export interface CreateRatingData {
  rideId: string;
  customerId: string;
  driverProfileId?: string | undefined;
  rating: number;
  review?: string | null | undefined;
}

export interface DriverRatingSummary {
  driverProfileId: string;
  averageRating: number;
  totalRatings: number;
}
