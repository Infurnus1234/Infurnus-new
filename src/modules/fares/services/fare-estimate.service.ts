import { FareCalculatorService } from "./fare-calculator.service.js";
import type {
  Coordinates,
  MapProvider,
} from "../../rides/providers/map.provider.js";
import type { FareCalculationResult } from "../types/fare.js";

export class FareEstimateService {
  constructor(
    private readonly mapProvider: MapProvider,
    private readonly fareCalculator: FareCalculatorService,
  ) {}

  async estimate(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<FareCalculationResult> {
    const route = await this.mapProvider.calculateRoute(
      origin,
      destination,
    );

    if (!route) {
      throw new Error("Route could not be calculated");
    }

    return this.fareCalculator.calculate({
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      currency: "INR",
    });
  }
}