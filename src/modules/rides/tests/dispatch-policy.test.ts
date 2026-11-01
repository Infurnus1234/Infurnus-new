import { describe, expect, it } from 'vitest';
import { dispatchPolicy } from '../services/dispatch-policy.js';
describe('approved dispatch policies', () => {
  it.each([
    ['passenger', 'auto', [2000, 5000, 10000], 25000],
    ['logistics', 'truck', [7000, 15000, 20000], 120000],
    ['service', 'towing', [25000], 600000],
    ['service', 'towing_van', [25000], 600000],
    ['premium', 'sedan', [], 3600000],
    ['service', 'ambulance', [25000], 30000],
  ])('%s/%s uses approved radii and deadline', (sector, category, radii, responseMs) => {
    expect(dispatchPolicy(sector as string, category as string)).toMatchObject({
      radiiMeters: radii,
      responseMs,
    });
  });
  it('applies the configured-radius service policy to all specialty categories', () => {
    for (const category of ['jcb', 'recovery', 'roadside_service'])
      expect(dispatchPolicy('service', category).kind).toBe('legacy');
  });
  it('ranks ambulance by distance and makes premium city-wide', () => {
    expect(dispatchPolicy('service', 'ambulance').rankByDistance).toBe(true);
    expect(dispatchPolicy('premium', 'sedan').cityWide).toBe(true);
  });
});
