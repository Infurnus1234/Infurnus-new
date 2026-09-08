import { describe, expect, it } from 'vitest';
import { RouteRecalculationService } from '../services/route-recalculation.service.js';

const provider = {
  calculateRoute: async () => null,
  calculateMatrix: async () => [],
  geocode: async () => null,
  places: async () => [],
};
const origin = { latitude: 12.9716, longitude: 77.5946 };

describe('RouteRecalculationService', () => {
  it('calculates when there is no previous route', () => {
    expect(new RouteRecalculationService(provider).shouldRecalculate(null, null, origin)).toBe(
      true,
    );
  });

  it('does not recalculate for a small recent movement', () => {
    expect(
      new RouteRecalculationService(provider, () => 10_000).shouldRecalculate(9_000, origin, {
        latitude: 12.97161,
        longitude: 77.59461,
      }),
    ).toBe(false);
  });

  it('recalculates after the time threshold', () => {
    expect(
      new RouteRecalculationService(provider, () => 31_000).shouldRecalculate(0, origin, origin),
    ).toBe(true);
  });

  it('recalculates after meaningful movement', () => {
    expect(
      new RouteRecalculationService(provider, () => 1_000).shouldRecalculate(999, origin, {
        latitude: 12.98,
        longitude: 77.6,
      }),
    ).toBe(true);
  });
});
