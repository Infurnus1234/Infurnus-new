import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware/auth.middleware.js';
import { requireRoles } from '../auth/middleware/authorization.middleware.js';
import { AppError } from '../../common/errors/app-error.js';
import type { CommonMapService } from './map.service.js';
import type { DriverRepository } from '../rides/repositories/driver.repository.js';
import { env } from '../../config/env.js';
import { FareCalculatorService } from '../fares/services/fare-calculator.service.js';

const coordinates = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
const routeInput = z
  .object({
    origin: coordinates,
    destination: coordinates,
    mode: z.enum(['driving', 'walking', 'bicycling']).default('driving'),
    avoidTolls: z.boolean().default(false),
  })
  .strict();
export function createMapRouter(maps: CommonMapService, drivers?: DriverRepository) {
  const router = Router();
  router.use(requireAuth);
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: maps.config.rateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => req.auth!.userId,
      handler: (_req, res) => {
        res.status(429).json({
          success: false,
          error: {
            code: 'MAP_RATE_LIMITED',
            message: 'Too many map requests; try again shortly',
          },
        });
      },
    }),
  );
  router.get('/search', async (req, res, next) => {
    try {
      const { query } = z
        .object({ query: z.string().trim().min(1).max(200) })
        .strict()
        .parse(req.query);
      res.json({ success: true, data: await maps.places(query), message: 'Locations retrieved' });
    } catch (error) {
      next(error);
    }
  });
  router.post('/geocode', async (req, res, next) => {
    try {
      const { address } = z
        .object({ address: z.string().trim().min(3).max(500) })
        .strict()
        .parse(req.body);
      const result = await maps.geocode(address);
      if (!result)
        throw new AppError('MAP_LOCATION_NOT_FOUND', 'Address could not be resolved', 404);
      res.json({ success: true, data: result, message: 'Address resolved' });
    } catch (error) {
      next(error);
    }
  });
  router.post('/reverse-geocode', async (req, res, next) => {
    try {
      const result = await maps.reverseGeocode(coordinates.parse(req.body));
      if (!result)
        throw new AppError('MAP_LOCATION_NOT_FOUND', 'Address could not be resolved', 404);
      res.json({ success: true, data: result, message: 'Coordinates resolved' });
    } catch (error) {
      next(error);
    }
  });
  router.post('/route', async (req, res, next) => {
    try {
      const input = routeInput.parse(req.body);
      const result = await maps.calculateRoute(input.origin, input.destination, {
        mode: input.mode,
        avoidTolls: input.avoidTolls,
      });
      if (!result) throw new AppError('MAP_ROUTE_UNAVAILABLE', 'No road route is available', 503);
      res.json({ success: true, data: result, message: 'Route calculated' });
    } catch (error) {
      next(error);
    }
  });
  router.post('/distance', async (req, res, next) => {
    try {
      const input = routeInput.extend({ kind: z.enum(['geographic', 'road']) }).parse(req.body);
      res.json({
        success: true,
        data: await maps.distance(input.origin, input.destination, input.kind, {
          mode: input.mode,
          avoidTolls: input.avoidTolls,
        }),
        message: 'Distance calculated',
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/eta', async (req, res, next) => {
    try {
      const input = routeInput.parse(req.body);
      const route = await maps.calculateRoute(input.origin, input.destination, {
        mode: input.mode,
        avoidTolls: input.avoidTolls,
      });
      if (!route) throw new AppError('MAP_ROUTE_UNAVAILABLE', 'No road route is available', 503);
      res.json({
        success: true,
        data: { etaSeconds: route.durationSeconds, source: 'road_route' },
        message: 'ETA calculated',
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/nearby-driver-count', async (req, res, next) => {
    try {
      const input = z
        .object({
          latitude: z.coerce.number().finite().min(-90).max(90),
          longitude: z.coerce.number().finite().min(-180).max(180),
          radiusMeters: z.coerce
            .number()
            .positive()
            .max(env.MAP_DRIVER_RADII_METERS.at(-1)!)
            .default(env.MAP_DRIVER_RADII_METERS[0]!),
          sector: z.enum(['passenger', 'logistics', 'service', 'premium']),
          vehicleCategory: z.string().trim().min(1).max(50),
        })
        .strict()
        .parse(req.query);
      new FareCalculatorService().validateEstimateCategory(input);
      await maps.assertServiceArea([input]);
      if (!drivers?.countNearbyEligible)
        throw new AppError(
          'MAP_AVAILABILITY_UNAVAILABLE',
          'Driver availability is temporarily unavailable',
          503,
        );
      const count = await drivers.countNearbyEligible(
        input.latitude,
        input.longitude,
        input.radiusMeters,
        new Date(Date.now() - env.DRIVER_LOCATION_STALE_SECONDS * 1000),
        input.sector,
        input.vehicleCategory,
      );
      res.json({
        success: true,
        data: { count, radiusMeters: input.radiusMeters },
        message: 'Driver availability retrieved',
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/metrics', requireRoles('admin', 'super_admin'), (_req, res) => {
    res.json({
      success: true,
      data: { operations: maps.snapshot(), externalRequestsByHour: maps.hourlyUsage() },
      message: 'Map usage metrics',
    });
  });
  return router;
}
