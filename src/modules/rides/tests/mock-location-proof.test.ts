import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  mockLocationGrantSchema,
  verifyMockLocationProof,
} from '../services/mock-location-proof.js';

describe('mock location device proof', () => {
  it('binds the signed sample to the enrolled key, driver, session and test window', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const now = new Date('2026-11-14T12:00:00.000Z');
    const grant = mockLocationGrantSchema.parse({
      driverId: '99f73337-d762-451e-9ea1-212ce34cf63e',
      customerId: '236bcc52-7f63-48ed-bf97-87451b3bdce8',
      sessionId: '77bb3f98-f5a4-4de8-a119-ed36b5e519ac',
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      startsAt: now.toISOString(),
      expiresAt: '2026-11-14T12:15:00.000Z',
    });
    const identity = { userId: grant.driverId, sessionId: grant.sessionId };
    const message = [
      'infurnus:patna-mock-location:v1',
      grant.driverId,
      grant.sessionId,
      now.toISOString(),
    ].join('\n');
    const proof = sign('sha256', Buffer.from(message), privateKey).toString('base64');
    expect(verifyMockLocationProof(grant, identity, now, proof, +now)).toBe(true);
    expect(verifyMockLocationProof(grant, { userId: grant.driverId }, now, proof, +now)).toBe(
      false,
    );
    expect(verifyMockLocationProof(grant, identity, now, 'invalid', +now)).toBe(false);
    expect(verifyMockLocationProof(grant, identity, now, proof, Date.parse(grant.expiresAt))).toBe(
      false,
    );
    expect(verifyMockLocationProof(grant, identity, new Date(+now + 1), proof, +now)).toBe(false);

    const destinationRide = { bookingId: '4457753', latitude: 25.603916, longitude: 85.136024 };
    const scoped = mockLocationGrantSchema.parse({ ...grant, destinationRide });
    const scopedProof = sign(
      'sha256',
      Buffer.from(
        [
          'infurnus:patna-mock-location:v2',
          grant.driverId,
          grant.sessionId,
          now.toISOString(),
          '4457753',
          '25.603916',
          '85.136024',
        ].join('\n'),
      ),
      privateKey,
    ).toString('base64');
    expect(verifyMockLocationProof(scoped, identity, now, scopedProof, +now)).toBe(true);
    expect(verifyMockLocationProof(scoped, identity, now, proof, +now)).toBe(false);
    for (const changed of [{ bookingId: '4457754' }, { latitude: 25.603917 }]) {
      expect(
        verifyMockLocationProof(
          { ...scoped, destinationRide: { ...destinationRide, ...changed } },
          identity,
          now,
          scopedProof,
          +now,
        ),
      ).toBe(false);
    }
  });
});
