import { AppError } from '../../../common/errors/app-error.js';
import type { VehicleType } from '../types/vehicle.js';

export function serviceConfiguration(type: VehicleType) {
  const fare = type.serviceFixedFare;
  const radius = type.serviceRadiusMeters ?? 25000;
  if (
    type.sector !== 'service' ||
    !type.active ||
    fare == null ||
    !Number.isSafeInteger(Math.round(fare * 100)) ||
    fare < 0 ||
    !Number.isInteger(radius) ||
    radius < 1 ||
    radius > 200000 ||
    type.baseFare !== null ||
    type.perKmRate !== null ||
    type.pricingReference ||
    type.hourlyBaseFares ||
    type.logisticsSlabs
  )
    throw new AppError(
      'SERVICE_CONFIGURATION_UNAVAILABLE',
      'This service is disabled or its fixed fare has not been configured.',
      422,
    );
  return { farePaise: Math.round(fare * 100), radiusMeters: radius };
}
