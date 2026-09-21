import { DEFAULT_FARE_PRICING } from '../config/fare.config.js';
import type {
  FareCalculationInput,
  FareCalculationResult,
  FarePricingConfig,
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
  constructor(private readonly pricing: FarePricingConfig = DEFAULT_FARE_PRICING) {}

  calculate(input: FareCalculationInput): FareCalculationResult {
    this.validateInput(input);
    this.validatePricing();

    let baseAmount = this.pricing.baseFare;
    let distanceAmount = this.calculateDistanceAmount(input.distanceMeters);
    let timeAmount = this.calculateTimeAmount(input.durationSeconds);
    let waitingAmount: number | undefined;
    let weightAmount: number | undefined;
    let loadingAmount: number | undefined;
    let fuelAmount: number | undefined;
    let taxAmount: number | undefined;

    // Sector-specific adjustments
    if (input.sector === 'logistics') {
      if (input.vehicleCategory === 'bike') {
        baseAmount = Math.round(this.pricing.baseFare * 0.6);
        distanceAmount = Math.round(distanceAmount * 0.7);
      } else if (input.vehicleCategory === 'mini_truck') {
        baseAmount = Math.round(this.pricing.baseFare * 2.5);
        distanceAmount = Math.round(distanceAmount * 1.8);
      }

      if (input.weightKg !== undefined && input.weightKg > 20) {
        weightAmount = Math.round((input.weightKg - 20) * 500);
      }

      if (input.hasLoadingAssistance) {
        loadingAmount = 15000;
      }
    } else if (input.sector === 'service') {
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
    } else if (input.sector === 'premium') {
      const hours = Math.max(1, input.rentalHours || 1);
      baseAmount = hours * 100000;
      timeAmount = 0;

      const fuelRate = input.fuelRatePerKm !== undefined && input.fuelRatePerKm > 0 ? input.fuelRatePerKm : 1500;
      fuelAmount = this.roundMoney((input.distanceMeters * fuelRate) / 1000, 'fuelAmount');
      distanceAmount = 0;
    } else if (input.sector === 'passenger') {
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

    if (input.waitingMinutes !== undefined && input.waitingMinutes > 3) {
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

    if (input.sector !== undefined && input.sector !== 'passenger') {
      taxAmount = Math.round(subtotal * 0.05);
    }

    const grossAmount = subtotal + (taxAmount ?? 0);

    this.assertSafeMoney(grossAmount, 'grossAmount');

    const result: FareCalculationResult = {
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      baseAmount,
      distanceAmount,
      timeAmount,
      grossAmount,
      currency: this.pricing.currency,
      pricingVersion: this.pricing.pricingVersion,
    };

    if (waitingAmount !== undefined) result.waitingAmount = waitingAmount;
    if (weightAmount !== undefined) result.weightAmount = weightAmount;
    if (loadingAmount !== undefined) result.loadingAmount = loadingAmount;
    if (fuelAmount !== undefined) result.fuelAmount = fuelAmount;
    if (taxAmount !== undefined) result.taxAmount = taxAmount;

    return result;
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
      throw new Error(`Invalid calculated ${fieldName}`);
    }

    const roundedAmount = Math.round(amount);

    this.assertSafeMoney(roundedAmount, fieldName);

    return roundedAmount;
  }

  private validateInput(input: FareCalculationInput): void {
    if (!Number.isFinite(input.distanceMeters)) {
      throw new Error('distanceMeters must be a finite number');
    }

    if (input.distanceMeters < 0) {
      throw new Error('distanceMeters cannot be negative');
    }

    if (!Number.isFinite(input.durationSeconds)) {
      throw new Error('durationSeconds must be a finite number');
    }

    if (input.durationSeconds < 0) {
      throw new Error('durationSeconds cannot be negative');
    }

    if (input.currency !== undefined && input.currency !== this.pricing.currency) {
      throw new Error(`Unsupported fare currency: ${input.currency}`);
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
        throw new Error(`Invalid fare pricing value for ${fieldName}`);
      }
    }

    if (!this.pricing.pricingVersion.trim()) {
      throw new Error('pricingVersion cannot be empty');
    }

    if (this.pricing.currency !== 'INR') {
      throw new Error(`Unsupported fare pricing currency: ${this.pricing.currency}`);
    }
  }

  private assertSafeMoney(amount: number, fieldName: string): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`Calculated ${fieldName} exceeds supported monetary range`);
    }
  }
}
