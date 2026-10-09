import type { VehicleType } from '../../vehicles/types/vehicle.js';
import {
  DEFAULT_FARE_PRICING,
  VEHICLE_FARE_PRICING,
  canonicalVehicleCode,
  LEGACY_SERVICE_CATEGORIES,
  LEGACY_PREMIUM_CATEGORIES,
  VEHICLE_PRICING_VERSION,
  VEHICLE_UNAVAILABLE_MESSAGE,
  FIXED_QUOTE_REQUIRED_MESSAGE,
} from '../config/fare.config.js';
import { AppError } from '../../../common/errors/app-error.js';
import type {
  FareCalculationInput,
  FareCalculationResult,
  FarePricingConfig,
  FareEstimateResult,
  VehiclePricing,
} from '../types/fare.js';

/**
 * Calculates the v1 INFURNUS fare.
 *
 * Formula:
 *
 *   Gross Fare =
 *     Base Fare
 *     + Distance Fare
 *     + Time Fare
 *
 * All monetary values are integer paise.
 */
export class FareCalculatorService {
  constructor(
    private readonly pricing: FarePricingConfig = DEFAULT_FARE_PRICING,
    private readonly vehiclePricing: typeof VEHICLE_FARE_PRICING = VEHICLE_FARE_PRICING,
  ) {}

  validateEstimateCategory(
    input: Pick<FareCalculationInput, 'sector' | 'vehicleCategory'>,
  ): VehiclePricing | null {
    if (
      !input.sector ||
      typeof input.vehicleCategory !== 'string' ||
      !input.vehicleCategory.trim()
    ) {
      throw new AppError(
        'FARE_INPUT_INVALID',
        'Select a sector and vehicle to estimate the fare.',
        400,
      );
    }
    if (input.sector !== 'passenger' && input.sector !== 'logistics') {
      this.validateVehicleFareConfiguration(input as FareCalculationInput);
      return null;
    }
    // Existing goods-bike tariff has no replacement in the supplied table.
    if (input.sector === 'logistics' && input.vehicleCategory === 'bike') return null;
    const category = input.vehicleCategory ?? '';
    const canonical = canonicalVehicleCode(input.sector, category);
    const sectorPricing = this.vehiclePricing[input.sector];
    const tariff =
      sectorPricing && Object.hasOwn(sectorPricing, canonical)
        ? sectorPricing[canonical]
        : undefined;
    if (!tariff) throw new AppError('FARE_CONFIGURATION_MISSING', VEHICLE_UNAVAILABLE_MESSAGE, 422);
    this.validateVehiclePricing(tariff);
    return tariff;
  }

  calculateEstimate(input: FareCalculationInput, configured?: VehicleType): FareEstimateResult {
    if (configured) {
      this.validateInput(input);
      if (!configured.active || configured.sector !== input.sector || configured.code === 'ftl')
        throw new AppError('FARE_CONFIGURATION_MISSING', VEHICLE_UNAVAILABLE_MESSAGE, 422);
      const baseFare = Math.round(configured.baseFare * 100),
        distanceRatePerKm = Math.round(configured.perKmRate * 100);
      if (
        !Number.isSafeInteger(baseFare) ||
        baseFare < 0 ||
        !Number.isSafeInteger(distanceRatePerKm) ||
        distanceRatePerKm < 0
      )
        throw new AppError('FARE_PRICING_INVALID', 'Invalid configured rates', 503);
      const pricingVersion = 'vehicle-type:' + configured.id + ':v' + configured.version;
      // Use the existing monetary calculation and rounding, with no additional charges
      // in the admin base + distance model. Legacy range/sector components stay intact.
      const bookingFare = this.calculateResolved(input, { baseFare, distanceRatePerKm }, true);
      bookingFare.pricingVersion = pricingVersion;
      bookingFare.vehicleConfiguration = {
        id: configured.id,
        code: configured.code,
        sector: configured.sector,
        version: configured.version,
        baseFarePaise: baseFare,
        perKmRatePaise: distanceRatePerKm,
      };
      const canonical = canonicalVehicleCode(configured.sector, input.vehicleCategory ?? '');
      const tariffs = this.vehiclePricing[configured.sector];
      const original =
        tariffs && Object.hasOwn(tariffs, canonical) ? tariffs[canonical] : undefined;
      const pricing = original ?? {
        displayName: configured.name,
        baseFare: { minimum: baseFare, maximum: baseFare },
        perKmRate: { minimum: distanceRatePerKm, maximum: distanceRatePerKm },
      };
      const estimatedFare =
        original && original.baseFare && !original.routeBased
          ? (this.calculateEstimate(input) as import('../types/fare.js').VehicleFareEstimate)
              .estimatedFare
          : { minimum: bookingFare, maximum: bookingFare };
      return {
        estimateType: 'range',
        vehicleCategory: input.vehicleCategory!,
        pricing,
        currency: 'INR',
        pricingVersion,
        distanceMeters: input.distanceMeters,
        durationSeconds: input.durationSeconds,
        ...(estimatedFare ? { estimatedFare } : {}),
        bookingFare,
        bookable: true,
        message: 'Booking uses the admin-configured fixed fare.',
      };
    }
    this.validateInput(input);
    this.validatePricing();
    const tariff = this.validateEstimateCategory(input);
    if (!tariff) return this.calculate(input);
    const common = {
      vehicleCategory: input.vehicleCategory!,
      pricing: tariff,
      currency: this.pricing.currency,
      pricingVersion: VEHICLE_PRICING_VERSION,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
    };
    if (tariff.routeBased || !tariff.baseFare) {
      return {
        ...common,
        estimateType: 'quote_required',
        bookable: false,
        message: VEHICLE_UNAVAILABLE_MESSAGE,
      };
    }
    const minimum = this.calculateResolved(input, {
      baseFare: tariff.baseFare.minimum,
      distanceRatePerKm: tariff.perKmRate.minimum,
    });
    const maximum =
      tariff.baseFare.maximum === null
        ? null
        : this.calculateResolved(input, {
            baseFare: tariff.baseFare.maximum,
            distanceRatePerKm: tariff.perKmRate.maximum,
          });
    const bookingFare = tariff.fixedRates
      ? this.calculateResolved(input, tariff.fixedRates)
      : undefined;
    return {
      ...common,
      estimateType: 'range',
      estimatedFare: { minimum, maximum },
      ...(bookingFare ? { bookingFare } : {}),
      bookable: bookingFare !== undefined,
      message: bookingFare
        ? 'Approximate fare range; booking uses the configured fixed quote.'
        : FIXED_QUOTE_REQUIRED_MESSAGE,
    };
  }

  private validateVehiclePricing(tariff: VehiclePricing): void {
    const valid = (value: number) => Number.isSafeInteger(value) && value >= 0;
    const base = tariff.baseFare;
    const rate = tariff.perKmRate;
    if (
      !rate ||
      !valid(rate.minimum) ||
      !valid(rate.maximum) ||
      rate.maximum < rate.minimum ||
      (!base && !tariff.routeBased) ||
      (base &&
        (!valid(base.minimum) ||
          (base.maximum !== null && (!valid(base.maximum) || base.maximum < base.minimum))))
    ) {
      throw new AppError(
        'FARE_PRICING_INVALID',
        'Vehicle pricing is temporarily unavailable.',
        503,
      );
    }
    const fixed = tariff.fixedRates;
    if (
      tariff.fixedRates !== undefined &&
      (!fixed ||
        !base ||
        tariff.routeBased ||
        !valid(fixed.baseFare) ||
        !valid(fixed.distanceRatePerKm) ||
        fixed.baseFare < base.minimum ||
        (base.maximum !== null && fixed.baseFare > base.maximum) ||
        fixed.distanceRatePerKm < rate.minimum ||
        fixed.distanceRatePerKm > rate.maximum)
    ) {
      throw new AppError(
        'FARE_PRICING_INVALID',
        'Vehicle pricing is temporarily unavailable.',
        503,
      );
    }
  }

  calculate(input: FareCalculationInput): FareCalculationResult {
    return this.calculateResolved(input);
  }

  private calculateResolved(
    input: FareCalculationInput,
    vehicleRates?: { baseFare: number; distanceRatePerKm: number },
    exactConfiguration = false,
  ): FareCalculationResult {
    this.validateInput(input);
    this.validatePricing();
    if (!vehicleRates) this.validateVehicleFareConfiguration(input);

    let baseAmount = vehicleRates?.baseFare ?? this.pricing.baseFare;
    let distanceAmount = vehicleRates
      ? this.roundMoney(
          (input.distanceMeters * vehicleRates.distanceRatePerKm) / 1000,
          'distanceAmount',
        )
      : this.calculateDistanceAmount(input.distanceMeters);
    let timeAmount = exactConfiguration ? 0 : this.calculateTimeAmount(input.durationSeconds);
    let waitingAmount: number | undefined;
    let weightAmount: number | undefined;
    let loadingAmount: number | undefined;
    let fuelAmount: number | undefined;
    let taxAmount: number | undefined;

    // Sector-specific adjustments
    if (!exactConfiguration && input.sector === 'logistics') {
      if (!vehicleRates && input.vehicleCategory === 'bike') {
        baseAmount = Math.round(this.pricing.baseFare * 0.6);
        distanceAmount = Math.round(distanceAmount * 0.7);
      } else if (!vehicleRates && input.vehicleCategory === 'mini_truck') {
        baseAmount = Math.round(this.pricing.baseFare * 2.5);
        distanceAmount = Math.round(distanceAmount * 1.8);
      }

      if (input.weightKg !== undefined && input.weightKg > 20) {
        weightAmount = Math.round((input.weightKg - 20) * 500);
      }

      if (input.hasLoadingAssistance) {
        loadingAmount = 15000;
      }
    } else if (!exactConfiguration && input.sector === 'service') {
      if (input.vehicleCategory === 'ambulance') {
        baseAmount = 50000;
        distanceAmount = this.roundMoney((input.distanceMeters * 2500) / 1000, 'distanceAmount');
      } else if (
        input.vehicleCategory === 'towing' ||
        input.vehicleCategory === 'towing_van' ||
        input.vehicleCategory === 'recovery' ||
        input.vehicleCategory === 'recovery_vehicle'
      ) {
        baseAmount = 60000;
        distanceAmount = this.roundMoney((input.distanceMeters * 3000) / 1000, 'distanceAmount');
      } else if (
        input.vehicleCategory === 'roadside_service' ||
        input.vehicleCategory === 'roadside_service_vehicle' ||
        input.vehicleCategory === 'roadside_recovery' ||
        input.vehicleCategory === 'roadside'
      ) {
        baseAmount = 60000;
        distanceAmount = this.roundMoney((input.distanceMeters * 3000) / 1000, 'distanceAmount');
      } else if (input.vehicleCategory === 'jcb') {
        // JCB trip-based pricing: Flat mobilization/base charge (120,000 paise / ₹1,200) + distance charge (4,000 paise/km / ₹40/km)
        baseAmount = 120000;
        distanceAmount = this.roundMoney((input.distanceMeters * 4000) / 1000, 'distanceAmount');
      } else {
        baseAmount = 60000;
        distanceAmount = this.roundMoney((input.distanceMeters * 3000) / 1000, 'distanceAmount');
      }
    } else if (!exactConfiguration && input.sector === 'premium') {
      const hours = Math.max(1, input.rentalHours || 1);
      baseAmount = hours * 100000;
      timeAmount = 0;

      const fuelRate =
        input.fuelRatePerKm !== undefined && input.fuelRatePerKm > 0 ? input.fuelRatePerKm : 1500;
      fuelAmount = this.roundMoney((input.distanceMeters * fuelRate) / 1000, 'fuelAmount');
      distanceAmount = 0;
    } else if (input.sector === 'passenger' && !vehicleRates) {
      if (input.vehicleCategory === 'auto') {
        baseAmount = Math.round(baseAmount * 0.7);
        distanceAmount = Math.round(distanceAmount * 0.7);
      } else if (input.vehicleCategory === 'sedan') {
        baseAmount = Math.round(baseAmount * 1.25);
        distanceAmount = Math.round(distanceAmount * 1.25);
      } else if (input.vehicleCategory === 'suv') {
        baseAmount = Math.round(baseAmount * 1.6);
        distanceAmount = Math.round(distanceAmount * 1.6);
      }
    }

    if (!exactConfiguration && input.waitingMinutes !== undefined && input.waitingMinutes > 3) {
      waitingAmount = Math.round((input.waitingMinutes - 3) * 200);
    }

    const subtotal =
      baseAmount +
      distanceAmount +
      timeAmount +
      (waitingAmount ?? 0) +
      (weightAmount ?? 0) +
      (loadingAmount ?? 0) +
      (fuelAmount ?? 0);

    if (!exactConfiguration && input.sector !== undefined && input.sector !== 'passenger') {
      taxAmount = Math.round(subtotal * 0.05);
    }

    const grossAmount = subtotal + (taxAmount ?? 0);
    const commissionRate = 0.10;
    const commissionAmount = Math.round(baseAmount * commissionRate);
    const driverEarnings = grossAmount - commissionAmount;

    this.assertSafeMoney(grossAmount, 'grossAmount');

    const result: FareCalculationResult = {
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      baseAmount,
      distanceAmount,
      timeAmount,
      grossAmount,
      commissionRate,
      commissionAmount,
      driverEarnings,
      currency: this.pricing.currency,
      pricingVersion: vehicleRates ? VEHICLE_PRICING_VERSION : this.pricing.pricingVersion,
    };

    if (waitingAmount !== undefined) result.waitingAmount = waitingAmount;
    if (weightAmount !== undefined) result.weightAmount = weightAmount;
    if (loadingAmount !== undefined) result.loadingAmount = loadingAmount;
    if (fuelAmount !== undefined) result.fuelAmount = fuelAmount;
    if (taxAmount !== undefined) result.taxAmount = taxAmount;

    return result;
  }

  private validateVehicleFareConfiguration(input: FareCalculationInput): void {
    const category = input.vehicleCategory;
    if (!input.sector || !category) return;

    const configuredCategories: Record<string, readonly string[]> = {
      passenger: ['auto', 'sedan', 'suv'],
      logistics: ['bike', 'mini_truck'],
      service: LEGACY_SERVICE_CATEGORIES,
      // Existing documented/used premium categories retain their hourly model.
      // New categories require an admin catalog entry before reaching this path.
      premium: LEGACY_PREMIUM_CATEGORIES,
    };

    const categories = configuredCategories[input.sector];
    if (!categories || !categories.includes(category)) {
      throw new AppError('FARE_CONFIGURATION_MISSING', VEHICLE_UNAVAILABLE_MESSAGE, 422);
    }
  }

  private calculateDistanceAmount(distanceMeters: number): number {
    const amount = (distanceMeters * this.pricing.distanceRatePerKm) / 1000;

    return this.roundMoney(amount, 'distanceAmount');
  }

  private calculateTimeAmount(durationSeconds: number): number {
    const amount = (durationSeconds * this.pricing.timeRatePerMinute) / 60;

    return this.roundMoney(amount, 'timeAmount');
  }

  private roundMoney(amount: number, fieldName: string): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new AppError('FARE_AMOUNT_INVALID', `Invalid calculated ${fieldName}`, 503);
    }

    const roundedAmount = Math.round(amount);

    this.assertSafeMoney(roundedAmount, fieldName);

    return roundedAmount;
  }

  private validateInput(input: FareCalculationInput): void {
    if (!Number.isFinite(input.distanceMeters)) {
      throw new AppError('FARE_INPUT_INVALID', 'distanceMeters must be a finite number', 400);
    }

    if (input.distanceMeters < 0) {
      throw new AppError('FARE_INPUT_INVALID', 'distanceMeters cannot be negative', 400);
    }

    if (!Number.isFinite(input.durationSeconds)) {
      throw new AppError('FARE_INPUT_INVALID', 'durationSeconds must be a finite number', 400);
    }

    if (input.durationSeconds < 0) {
      throw new AppError('FARE_INPUT_INVALID', 'durationSeconds cannot be negative', 400);
    }

    for (const value of [
      input.waitingMinutes,
      input.weightKg,
      input.rentalHours,
      input.fuelRatePerKm,
    ]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new AppError(
          'FARE_INPUT_INVALID',
          'Fare inputs must be finite and nonnegative.',
          400,
        );
      }
    }

    if (input.currency !== undefined && input.currency !== this.pricing.currency) {
      throw new AppError('FARE_INPUT_INVALID', `Unsupported fare currency: ${input.currency}`, 400);
    }
  }

  private validatePricing(): void {
    const monetaryFields = [
      ['baseFare', this.pricing.baseFare],
      ['distanceRatePerKm', this.pricing.distanceRatePerKm],
      ['timeRatePerMinute', this.pricing.timeRatePerMinute],
    ] as const;

    for (const [fieldName, value] of monetaryFields) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new AppError(
          'FARE_PRICING_INVALID',
          `Invalid fare pricing value for ${fieldName}`,
          503,
        );
      }
    }

    if (typeof this.pricing.pricingVersion !== 'string' || !this.pricing.pricingVersion.trim()) {
      throw new AppError('FARE_PRICING_INVALID', 'pricingVersion cannot be empty', 503);
    }

    if (this.pricing.currency !== 'INR') {
      throw new AppError(
        'FARE_PRICING_INVALID',
        `Unsupported fare pricing currency: ${this.pricing.currency}`,
        503,
      );
    }
  }

  private assertSafeMoney(amount: number, fieldName: string): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new AppError(
        'FARE_AMOUNT_INVALID',
        `Calculated ${fieldName} exceeds supported monetary range`,
        503,
      );
    }
  }
}
