import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireFleetOwner } from '../../auth/middleware/authorization.middleware.js';

const modelText = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine(
    (v) =>
      !/[<>]/.test(v) &&
      [...v].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
    'Use a plain vehicle name',
  )
  .transform((v) => v.replace(/\s+/g, ' '));
export const vehicleModelSchema = z.object({ make: modelText, model: modelText }).strict();

// Mounted behind provider authentication. Models do not grant category suitability,
// approval, pricing or dispatch eligibility; those remain on vehicle operations.
export function createProviderModelRouter(pool: Pool) {
  const router = Router();
  router.get('/vehicle-models', async (req, res, next) => {
    try {
      const { search } = z
        .object({ search: z.string().trim().max(100).default('') })
        .strict()
        .parse(req.query);
      const result = await pool.query(
        `SELECT DISTINCT make,model FROM (
          SELECT make,model FROM vehicles WHERE owner_id=$1
          UNION SELECT make,model FROM fleet_vehicle_models WHERE owner_id=$1
          UNION SELECT make,model FROM vehicle_model_catalog
        ) models WHERE strpos(lower(make || ' ' || model),lower($2))>0
        ORDER BY make,model LIMIT 50`,
        [req.auth!.userId, search],
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      next(error);
    }
  });
  router.post('/vehicle-models', requireFleetOwner(), async (req, res, next) => {
    try {
      const input = vehicleModelSchema.parse(req.body);
      const result = await pool.query(
        `INSERT INTO fleet_vehicle_models(owner_id,make,model) VALUES($1,$2,$3)
         ON CONFLICT(owner_id,normalized_make,normalized_model)
         DO UPDATE SET model=fleet_vehicle_models.model RETURNING id,make,model`,
        [req.auth!.userId, input.make, input.model],
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
