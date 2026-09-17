import { FareCalculatorService } from './fare-calculator.service.js';
import type { Coordinates, MapProvider } from '../../rides/providers/map.provider.js';
import type { FareCalculationResult } from '../types/fare.js';

export interface FallbackRouteConfig {
  allowFallback?: boolean;
  averageSpeedKmph?: number;
  estimatedDetourFactor?: number;
}

export function calculateHaversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c);
}

export class FareEstimateService {
  constructor(
    private readonly mapProvider: MapProvider,
    private readonly fareCalculator: FareCalculatorService,
    private readonly defaultFallbackConfig: FallbackRouteConfig = {
      allowFallback: true,
      averageSpeedKmph: 25,
      estimatedDetourFactor: 1.3,
    },
  ) {}

  async estimate(
    origin: Coordinates,
    destination: Coordinates,
    options?: {
      sector?: 'passenger' | 'logistics' | 'service' | 'premium' | undefined;
      vehicleCategory?: string | undefined;
      waitingMinutes?: number | undefined;
      weightKg?: number | undefined;
      hasLoadingAssistance?: boolean | undefined;
      rentalHours?: number | undefined;
      fuelRatePerKm?: number | undefined;
      fallbackConfig?: FallbackRouteConfig | undefined;
    },
  ): Promise<FareCalculationResult> {
    const route = await this.mapProvider.calculateRoute(origin, destination);

    if (route) {
      const result = this.fareCalculator.calculate({
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        currency: 'INR',
        ...options,
      });
      result.routeSource = 'google_maps_road';
      return result;
    }

    const fallback = {
      ...this.defaultFallbackConfig,
      ...options?.fallbackConfig,
    };

    if (!fallback.allowFallback) {
      throw new Error('Route could not be calculated and fallback is disabled');
    }

    const straightLineMeters = calculateHaversineDistanceMeters(origin, destination);
    const detourFactor = fallback.estimatedDetourFactor ?? 1.3;
    const estimatedDistanceMeters = Math.max(500, Math.round(straightLineMeters * detourFactor));
    const speedKmph = fallback.averageSpeedKmph ?? 25;
    const estimatedDurationSeconds = Math.max(
      60,
      Math.round((estimatedDistanceMeters / (speedKmph * 1000)) * 3600),
    );

    const result = this.fareCalculator.calculate({
      distanceMeters: estimatedDistanceMeters,
      durationSeconds: estimatedDurationSeconds,
      currency: 'INR',
      ...options,
    });

    result.routeSource = 'haversine_estimated';
    result.straightLineDistanceMeters = straightLineMeters;
    return result;
  }
}
