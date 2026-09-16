import { DEFAULT_FARE_PRICING } from "../config/fare.config.js";
import type {
  FareCalculationInput,
  FareCalculationResult,
  FarePricingConfig,
} from "../types/fare.js";

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
  ) {}

  calculate(input: FareCalculationInput): FareCalculationResult {
    this.validateInput(input);
    this.validatePricing();

    const distanceAmount = this.calculateDistanceAmount(
      input.distanceMeters,
    );

    const timeAmount = this.calculateTimeAmount(input.durationSeconds);

    const grossAmount =
      this.pricing.baseFare +
      distanceAmount +
      timeAmount;

    this.assertSafeMoney(grossAmount, "grossAmount");

    return {
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      baseAmount: this.pricing.baseFare,
      distanceAmount,
      timeAmount,
      grossAmount,
      currency: this.pricing.currency,
      pricingVersion: this.pricing.pricingVersion,
    };
  }

  private calculateDistanceAmount(distanceMeters: number): number {
    const amount =
      (distanceMeters * this.pricing.distanceRatePerKm) / 1000;

    return this.roundMoney(amount, "distanceAmount");
  }

  private calculateTimeAmount(durationSeconds: number): number {
    const amount =
      (durationSeconds * this.pricing.timeRatePerMinute) / 60;

    return this.roundMoney(amount, "timeAmount");
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
      throw new Error("distanceMeters must be a finite number");
    }

    if (input.distanceMeters < 0) {
      throw new Error("distanceMeters cannot be negative");
    }

    if (!Number.isFinite(input.durationSeconds)) {
      throw new Error("durationSeconds must be a finite number");
    }

    if (input.durationSeconds < 0) {
      throw new Error("durationSeconds cannot be negative");
    }

    if (
      input.currency !== undefined &&
      input.currency !== this.pricing.currency
    ) {
      throw new Error(
        `Unsupported fare currency: ${input.currency}`,
      );
    }
  }

  private validatePricing(): void {
    const monetaryFields = [
      ["baseFare", this.pricing.baseFare],
      ["distanceRatePerKm", this.pricing.distanceRatePerKm],
      ["timeRatePerMinute", this.pricing.timeRatePerMinute],
    ] as const;

    for (const [fieldName, value] of monetaryFields) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(
          `Invalid fare pricing value for ${fieldName}`,
        );
      }
    }

    if (!this.pricing.pricingVersion.trim()) {
      throw new Error("pricingVersion cannot be empty");
    }

    if (this.pricing.currency !== "INR") {
      throw new Error(
        `Unsupported fare pricing currency: ${this.pricing.currency}`,
      );
    }
  }

  private assertSafeMoney(amount: number, fieldName: string): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(
        `Calculated ${fieldName} exceeds supported monetary range`,
      );
    }
  }
}