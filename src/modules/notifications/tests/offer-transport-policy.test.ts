import { describe, expect, it } from 'vitest';
import { offerTransportPolicy } from '../services/offer-transport-policy.js';
describe('authoritative offer transport lifetime', () => {
  it('bounds Android and APNs storage to the remaining window', () => {
    expect(
      offerTransportPolicy('2026-10-20T12:00:20.000Z', Date.parse('2026-10-20T12:00:00.000Z')),
    ).toEqual({
      ttl: 20000,
      apnsExpiration: String(Date.parse('2026-10-20T12:00:20.000Z') / 1000),
    });
  });
  it('recomputes the remaining window on retries', () => {
    expect(
      offerTransportPolicy('2026-10-20T12:00:20.000Z', Date.parse('2026-10-20T12:00:18.500Z'))?.ttl,
    ).toBe(1500);
  });
  it('rejects expired and malformed windows', () => {
    expect(() => offerTransportPolicy('bad')).toThrow('OFFER_EXPIRED');
    expect(() =>
      offerTransportPolicy('2026-10-20T12:00:00Z', Date.parse('2026-10-20T12:00:00Z')),
    ).toThrow('OFFER_EXPIRED');
  });
  it('does not invent expiry for lifecycle messages', () => {
    expect(offerTransportPolicy(undefined)).toBeUndefined();
  });
});
