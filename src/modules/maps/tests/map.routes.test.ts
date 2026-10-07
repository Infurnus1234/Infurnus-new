import express from 'express';
import { ServiceAreaPolicy, type ServiceAreaGate } from '../service-area.js';
import { AppError } from '../../../common/errors/app-error.js';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMapRouter } from '../map.routes.js';
import { CommonMapService } from '../map.service.js';
import { mapConfig } from '../map.config.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import type { DriverRepository } from '../../rides/repositories/driver.repository.js';
vi.mock('../../auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(async (token: string) => ({
    sub: token,
    role: token === 'admin' ? 'admin' : 'user',
    type: 'access',
  })),
}));
function app(limit = 120, area?: ServiceAreaGate) {
  const provider = {
    calculateRoute: vi.fn(async () => ({ distanceMeters: 1000, durationSeconds: 60 })),
    calculateMatrix: async () => [],
    geocode: async () => ({ latitude: 25.5941, longitude: 85.1376 }),
    reverseGeocode: async (p: { latitude: number; longitude: number }) => ({
      address: 'Provider address',
      coordinates: p,
    }),
    places: async () => [{ placeId: 'provider-id', description: 'Patna, Bihar, India' }],
  };
  const maps = new CommonMapService(
    provider,
    undefined,
    { ...mapConfig, rateLimit: limit },
    Date.now,
    () => {},
    area,
  );
  const count = vi.fn(async () => 3);
  const server = express();
  server.use(express.json());
  server.use(
    '/maps',
    createMapRouter(maps, { countNearbyEligible: count } as unknown as DriverRepository),
  );
  server.use(errorMiddleware);
  return { server, provider, count };
}
const route = {
  origin: { latitude: 25.5941, longitude: 85.1376 },
  destination: { latitude: 25.6, longitude: 85.14 },
};
describe('authenticated map API contracts', () => {
  it('requires authentication', async () => {
    expect((await request(app().server).get('/maps/search?query=pat')).status).toBe(401);
  });
  it('returns ranked provider search results in existing envelope', async () => {
    const response = await request(app().server)
      .get('/maps/search?query=pat')
      .set('Authorization', 'Bearer user');
    expect(response.body).toMatchObject({ success: true, data: [{ placeId: 'provider-id' }] });
  });
  it.each(['/geocode', '/reverse-geocode', '/route', '/distance', '/eta'])(
    'validates %s request',
    async (path) => {
      expect(
        (
          await request(app().server)
            .post(`/maps${path}`)
            .set('Authorization', 'Bearer user')
            .send({ latitude: 91 })
        ).status,
      ).toBe(400);
    },
  );
  it('returns road distance and ETA without exposing provider secrets', async () => {
    const a = app();
    const response = await request(a.server)
      .post('/maps/eta')
      .set('Authorization', 'Bearer user')
      .send(route);
    expect(response.body.data).toEqual({ etaSeconds: 60, source: 'road_route' });
    expect(JSON.stringify(response.body)).not.toContain('key');
  });
  it('calculates geographic distance without provider request', async () => {
    const a = app();
    const response = await request(a.server)
      .post('/maps/distance')
      .set('Authorization', 'Bearer user')
      .send({ ...route, kind: 'geographic' });
    expect(response.status).toBe(200);
    expect(a.provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('returns count only, supports 1km and 2km, and rejects unbounded radius', async () => {
    const a = app();
    for (const radius of [1000, 2000]) {
      const response = await request(a.server)
        .get(
          `/maps/nearby-driver-count?latitude=25.5941&longitude=85.1376&sector=passenger&vehicleCategory=sedan&radiusMeters=${radius}`,
        )
        .set('Authorization', 'Bearer user');
      expect(response.body.data).toEqual({ count: 3, radiusMeters: radius });
    }
    expect(
      (
        await request(a.server)
          .get(
            '/maps/nearby-driver-count?latitude=25&longitude=85&sector=passenger&vehicleCategory=sedan&radiusMeters=100000',
          )
          .set('Authorization', 'Bearer user')
      ).status,
    ).toBe(400);
  });
  it('restricts metrics to administrators', async () => {
    const a = app();
    expect(
      (await request(a.server).get('/maps/metrics').set('Authorization', 'Bearer user')).status,
    ).toBe(403);
    expect(
      (await request(a.server).get('/maps/metrics').set('Authorization', 'Bearer admin')).status,
    ).toBe(200);
  });
  it('rate limits expensive map requests per authenticated identity', async () => {
    const a = app(1);
    await request(a.server).get('/maps/search?query=pat').set('Authorization', 'Bearer user');
    expect(
      (await request(a.server).get('/maps/search?query=pat').set('Authorization', 'Bearer user'))
        .status,
    ).toBe(429);
    expect(
      (await request(a.server).get('/maps/search?query=pat').set('Authorization', 'Bearer another'))
        .status,
    ).toBe(200);
  });
});

describe('service-area API contract', () => {
  it('returns the coming-soon envelope without routing or availability work', async () => {
    const area: ServiceAreaGate = {
      configured: true,
      required: true,
      assertSupported: async () => {
        throw new AppError('SERVICE_AREA_UNAVAILABLE', "We're coming soon to your area.", 422);
      },
    };
    const { server, provider, count } = app(120, area);
    const result = await request(server)
      .post('/maps/route')
      .set('Authorization', 'Bearer user')
      .send(route);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      success: false,
      error: {
        code: 'SERVICE_AREA_UNAVAILABLE',
        message: "We're coming soon to your area.",
      },
    });
    const availability = await request(server)
      .get(
        '/maps/nearby-driver-count?latitude=25.5941&longitude=85.1376&sector=passenger&vehicleCategory=sedan',
      )
      .set('Authorization', 'Bearer user');
    expect(availability.status).toBe(422);
    expect(count).not.toHaveBeenCalled();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('returns configuration failure when an approved production boundary is missing', async () => {
    const { server, provider } = app(120, new ServiceAreaPolicy(undefined, true));
    const result = await request(server)
      .post('/maps/route')
      .set('Authorization', 'Bearer user')
      .send(route);
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('SERVICE_AREA_NOT_CONFIGURED');
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
});
