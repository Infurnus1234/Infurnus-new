import type { VehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { canonicalVehicleCode, VEHICLE_UNAVAILABLE_MESSAGE } from '../config/fare.config.js';
import { geographicDistance } from '../../maps/geometry.js';
import { FareCalculatorService } from './fare-calculator.service.js';
import type { Coordinates, MapProvider } from '../../rides/providers/map.provider.js';
import type { FareEstimateResult } from '../types/fare.js';
import { AppError } from '../../../common/errors/app-error.js';

export interface FallbackRouteConfig {
  allowFallback?: boolean;
  averageSpeedKmph?: number;
  estimatedDetourFactor?: number;
}

export function calculateHaversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  return Math.round(geographicDistance(a, b));
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
    private readonly vehicles?: VehicleRepository,
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
      pricingMode?: 'vehicle_range';
    },
  ): Promise<FareEstimateResult> {
    for (const coordinate of [origin, destination]) {
      if (
        !coordinate ||
        !Number.isFinite(coordinate.latitude) ||
        !Number.isFinite(coordinate.longitude) ||
        Math.abs(coordinate.latitude) > 90 ||
        Math.abs(coordinate.longitude) > 180
      ) {
        throw new AppError(
          'FARE_INPUT_INVALID',
          'Select valid pickup and destination coordinates.',
          400,
        );
      }
    }
    if (options?.pricingMode === 'vehicle_range') await this.resolveConfiguration(options);
    let route;
    try {
      const maps =
        this.mapProvider.forSource?.(
          options?.sector === 'logistics'
            ? 'LOGISTICS'
            : options?.sector === 'premium'
              ? 'RENTAL'
              : 'RIDE',
        ) ?? this.mapProvider;
      route = await maps.calculateRoute(origin, destination);
    } catch (error) {
      if (error instanceof AppError && error.code.startsWith('SERVICE_AREA_')) throw error;
      throw new AppError(
        'FARE_ROUTE_UNAVAILABLE',
        'The route is temporarily unavailable. Please try again.',
        503,
      );
    }

    if (route) {
      if (
        !Number.isFinite(route.distanceMeters) ||
        route.distanceMeters < 0 ||
        !Number.isFinite(route.durationSeconds) ||
        route.durationSeconds < 0
      ) {
        throw new AppError(
          'FARE_ROUTE_INVALID',
          'The routing service returned invalid fare route data.',
          503,
        );
      }
      const result = await this.calculate(
        {
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          currency: 'INR',
          ...options,
        },
        options?.pricingMode,
      );
      result.routeSource = 'google_maps_road';
      return result;
    }

    const fallback = {
      ...this.defaultFallbackConfig,
      ...options?.fallbackConfig,
    };

    if (!fallback.allowFallback) {
      throw new AppError(
        'FARE_ROUTE_UNAVAILABLE',
        'Route could not be calculated and fallback is disabled',
        503,
      );
    }

    const straightLineMeters = calculateHaversineDistanceMeters(origin, destination);
    const detourFactor = fallback.estimatedDetourFactor ?? 1.3;
    const speedKmph = fallback.averageSpeedKmph ?? 25;
    if (
      !Number.isFinite(detourFactor) ||
      detourFactor <= 0 ||
      !Number.isFinite(speedKmph) ||
      speedKmph <= 0
    ) {
      throw new AppError(
        'FARE_PRICING_INVALID',
        'Fare routing configuration is temporarily unavailable.',
        503,
      );
    }
    const estimatedDistanceMeters = Math.max(500, Math.round(straightLineMeters * detourFactor));
    const estimatedDurationSeconds = Math.max(
      60,
      Math.round((estimatedDistanceMeters / (speedKmph * 1000)) * 3600),
    );

    const result = await this.calculate(
      {
        distanceMeters: estimatedDistanceMeters,
        durationSeconds: estimatedDurationSeconds,
        currency: 'INR',
        ...options,
      },
      options?.pricingMode,
    );

    result.routeSource = 'haversine_estimated';
    result.straightLineDistanceMeters = straightLineMeters;
    return result;
  }

  private async resolveConfiguration(input: {
    sector?: string | undefined;
    vehicleCategory?: string | undefined;
  }) {
    const code = canonicalVehicleCode(input.sector ?? '', input.vehicleCategory ?? '');
    const configured = this.vehicles?.findTypeByCode
      ? await this.vehicles.findTypeByCode(code)
      : null;
    // A shared legacy identifier (e.g. passenger/goods bike) keeps its own sector tariff.
    if (configured && configured.sector === input.sector) {
      if (!configured.active || configured.sector !== input.sector || configured.code === 'ftl')
        throw new AppError('FARE_CONFIGURATION_MISSING', VEHICLE_UNAVAILABLE_MESSAGE, 422);
      return configured;
    }
    this.fareCalculator.validateEstimateCategory(
      input as Parameters<FareCalculatorService['validateEstimateCategory']>[0],
    );
    return null;
  }
  private async calculate(
    input: Parameters<FareCalculatorService['calculate']>[0],
    mode?: 'vehicle_range',
  ): Promise<FareEstimateResult> {
    const configured =
      mode === 'vehicle_range' ? await this.resolveConfiguration(input) : undefined;
    return mode === 'vehicle_range'
      ? this.fareCalculator.calculateEstimate(input, configured ?? undefined)
      : this.fareCalculator.calculate(input);
  }
}
