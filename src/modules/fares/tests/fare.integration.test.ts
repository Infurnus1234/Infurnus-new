import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import type { FareEstimateService } from '../services/fare-estimate.service.js';

describe('Fare HTTP integration', () => {
  const fare = {
    distanceMeters: 5000,
    durationSeconds: 900,
    baseAmount: 500,
    distanceAmount: 6000,
    timeAmount: 3000,
    grossAmount: 9500,
    currency: 'INR' as const,
    pricingVersion: 'v1',
  };

  const validBody = {
    pickup: {
      latitude: 26.9124,
      longitude: 75.7873,
    },
    destination: {
      latitude: 26.8467,
      longitude: 75.802,
    },
  };

  function createTestApp() {
    const estimate = vi.fn().mockResolvedValue(fare);

    const fareEstimateService = {
      estimate,
    } as unknown as FareEstimateService;

    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fareEstimateService,
    );

    return {
      app,
      estimate,
    };
  }

  describe('POST /fares/estimate', () => {
    it('rejects unauthenticated requests', async () => {
      const { app, estimate } = createTestApp();

      const response = await request(app).post('/fares/estimate').send(validBody);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);

      expect(estimate).not.toHaveBeenCalled();
    });

    it('rejects invalid request data', async () => {
      const { app, estimate } = createTestApp();

      const response = await request(app)
        .post('/fares/estimate')
        .send({
          pickup: {
            latitude: 91,
            longitude: 77.7873,
          },
          destination: validBody.destination,
        });

      expect(response.status).toBe(401);

      expect(response.body.success).toBe(false);

      expect(estimate).not.toHaveBeenCalled();
    });

    it('rejects unexpected request fields', async () => {
      const { app, estimate } = createTestApp();

      const response = await request(app)
        .post('/fares/estimate')
        .send({
          ...validBody,
          amount: 100,
        });

      expect(response.status).toBe(401);

      expect(response.body.success).toBe(false);

      expect(estimate).not.toHaveBeenCalled();
    });
  });
});
