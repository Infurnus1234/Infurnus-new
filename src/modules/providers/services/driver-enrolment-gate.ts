import type { RequestHandler } from 'express';
import { pool } from '../../../infrastructure/database/postgres.js';
import { AppError } from '../../../common/errors/app-error.js';
// Existing approved legacy clients retain operational eligibility checks. Once
// Dashboard setup may be deferred. Operational routes still apply their own
// approved-profile, assigned-vehicle, membership and compliance checks.
export const requireDriverEnrolment: RequestHandler = async (req, _res, next) => {
  try {
    if (req.auth?.role === 'driver') {
      const s = (
        await pool.query(
          'SELECT role_flow_active,dashboard_deferred_at,flow_completed_at FROM provider_onboarding WHERE user_id=$1',
          [req.auth.userId],
        )
      ).rows[0];
      if (s?.role_flow_active && !s.dashboard_deferred_at && !s.flow_completed_at)
        throw new AppError(
          'DRIVER_ONBOARDING_REQUIRED',
          'Complete or defer Driver setup before going online',
          403,
        );
    }
    next();
  } catch (e) {
    next(e);
  }
};
