import type { FareEstimateResult } from '../types/fare.js';

function omitInternalDistance<T extends FareEstimateResult>({
  billableDistanceMeters: _billableDistanceMeters,
  distanceMultiplier: _distanceMultiplier,
  ...fare
}: T) {
  return fare;
}

export function publicFareEstimate(fare: FareEstimateResult) {
  if (!('estimateType' in fare)) return omitInternalDistance(fare);

  const { estimatedFare, bookingFare, ...estimate } = omitInternalDistance(fare);
  return {
    ...estimate,
    ...(estimatedFare && {
      estimatedFare: {
        minimum: omitInternalDistance(estimatedFare.minimum),
        maximum: estimatedFare.maximum && omitInternalDistance(estimatedFare.maximum),
      },
    }),
    ...(bookingFare && { bookingFare: omitInternalDistance(bookingFare) }),
  };
}
