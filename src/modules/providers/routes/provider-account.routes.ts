import { Router } from 'express';
import { createProviderModelRouter } from './provider-model.routes.js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error.js';
import { updateUserSchema } from '../../users/schemas/user.schemas.js';
import { requireFleetOwner } from '../../auth/middleware/authorization.middleware.js';
import { ProviderIdentityRepository } from '../repositories/provider-identity.repository.js';
import { verifyAccessToken } from '../../auth/utils/jwt.js';

export const customVehicleTypeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(
        (v) =>
          !/[<>]/.test(v) &&
          [...v].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
        'Use a plain vehicle name',
      )
      .transform((v) => v.replace(/\s+/g, ' ')),
    sector: z.enum(['passenger', 'logistics', 'service', 'premium', 'rental']),
  })
  .strict();

const projection = `provider_public_id(u.id) AS "publicId",u.id,u.first_name AS "firstName",u.last_name AS "lastName",
 COALESCE(c.email,u.email) AS email,COALESCE(c.phone,u.phone) AS phone,
 (c.email IS NULL AND u.email_verified) AS "emailVerified",
 (c.phone IS NULL AND u.phone_verified) AS "phoneVerified",
 CASE WHEN EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m WHERE m.driver_user_id=u.id
 AND (m.provisioned_email IS NOT NULL OR m.provisioned_phone IS NOT NULL))
 THEN 'fleet_provisioned' ELSE 'self_registered' END AS "accountOrigin"`;

// Mounted behind the existing provider authentication, role and rate-limit middleware.
export function createProviderAccountRouter(pool: Pool) {
  const router = Router();
  const identities = new ProviderIdentityRepository(pool);
  router.get('/identity/:publicId', async (req, res, next) => {
    try {
      const publicId = z
        .string()
        .regex(/^[1-9][0-9]{5,63}$/)
        .parse(req.params.publicId);
      res.json({ success: true, data: await identities.lookup(publicId, req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/identity/link', async (req, res, next) => {
    try {
      const { otherAccessToken } = z
        .object({ otherAccessToken: z.string().min(1).max(8192) })
        .strict()
        .parse(req.body);
      const other = await verifyAccessToken(otherAccessToken).catch(() => {
        throw new AppError(
          'INVALID_LINK_SESSION',
          'Sign in to the other account again before linking',
          401,
        );
      });
      if (!req.auth!.sessionId || !other.sid)
        throw new AppError(
          'SESSION_REFRESH_REQUIRED',
          'Sign in to both accounts before linking',
          401,
        );
      res.json({
        success: true,
        data: await identities.linkVerified(
          req.auth!.userId,
          other.sub,
          `dual-session:${req.auth!.sessionId}:${other.sid}`,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.use(createProviderModelRouter(pool));
  router.get('/account', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT ${projection} FROM users u
        LEFT JOIN provider_profile_contacts c ON c.user_id=u.id
        WHERE u.id=$1 AND u.deleted_at IS NULL`,
        [req.auth!.userId],
      );
      if (!result.rowCount) throw new AppError('USER_NOT_FOUND', 'Account not found', 404);
      res.json({ success: true, data: result.rows[0] });
    } catch (e) {
      next(e);
    }
  });
  router.patch('/account', async (req, res, next) => {
    try {
      const input = updateUserSchema.parse(req.body);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const user = await client.query(
          `UPDATE users SET
          first_name=COALESCE($2,first_name),last_name=COALESCE($3,last_name),updated_at=NOW()
          WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
          [req.auth!.userId, input.firstName ?? null, input.lastName ?? null],
        );
        if (!user.rowCount) throw new AppError('USER_NOT_FOUND', 'Account not found', 404);
        if (input.email !== undefined || input.phone !== undefined) {
          await client.query(
            `INSERT INTO provider_profile_contacts(user_id,email,phone) VALUES($1,$2,$3)
            ON CONFLICT(user_id) DO UPDATE SET
            email=CASE WHEN $4 THEN EXCLUDED.email ELSE provider_profile_contacts.email END,
            phone=CASE WHEN $5 THEN EXCLUDED.phone ELSE provider_profile_contacts.phone END,updated_at=NOW()`,
            [
              req.auth!.userId,
              input.email ?? null,
              input.phone ?? null,
              input.email !== undefined,
              input.phone !== undefined,
            ],
          );
        }
        const result = await client.query(
          `SELECT ${projection} FROM users u
          LEFT JOIN provider_profile_contacts c ON c.user_id=u.id WHERE u.id=$1`,
          [req.auth!.userId],
        );
        await client.query('COMMIT');
        res.json({ success: true, data: result.rows[0] });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      next(e);
    }
  });
  router.post('/vehicle-catalog/custom', requireFleetOwner(), async (req, res, next) => {
    try {
      const input = customVehicleTypeSchema.parse(req.body);
      const canonical = await pool.query(
        `SELECT id,code,name,sector,active FROM vehicle_types
        WHERE sector=$1 AND lower(regexp_replace(btrim(name),'\\s+',' ','g'))=lower($2) UNION ALL SELECT NULL::uuid AS id,code,name,sector,FALSE AS active FROM fleet_registration_vehicle_types WHERE sector=$1 AND lower(regexp_replace(btrim(name),'\\s+',' ','g'))=lower($2) LIMIT 1`,
        [input.sector, input.name],
      );
      if (canonical.rowCount) {
        res.json({ success: true, data: canonical.rows[0] });
        return;
      }
      const result = await pool.query(
        `INSERT INTO fleet_custom_vehicle_types(owner_id,name,normalized_name,sector)
        VALUES($1,$2::text,lower($2::text),$3) ON CONFLICT(owner_id,sector,normalized_name)
        DO UPDATE SET name=fleet_custom_vehicle_types.name
        RETURNING id,code,name,sector,FALSE AS active,TRUE AS custom`,
        [req.auth!.userId, input.name, input.sector],
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
