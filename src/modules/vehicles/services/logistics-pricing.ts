import { AppError } from '../../../common/errors/app-error.js';
export type LogisticsSlabs = Record<
  'below_15' | 'from_15',
  { baseFare: number; perKmRate: number }
>;
export function logisticsSlab(slabs: LogisticsSlabs, distanceMeters: number) {
  const key: 'below_15' | 'from_15' = distanceMeters < 15000 ? 'below_15' : 'from_15';
  const rate = slabs[key];
  if (
    !rate ||
    ![rate.baseFare, rate.perKmRate].every(
      (v) => Number.isFinite(v) && v >= 0 && Number.isSafeInteger(Math.round(v * 100)),
    )
  )
    throw new AppError(
      'FARE_CONFIGURATION_MISSING',
      'Configure both Logistics distance slabs',
      422,
    );
  return {
    key,
    baseFare: Math.round(rate.baseFare * 100),
    distanceRatePerKm: Math.round(rate.perKmRate * 100),
  };
}
