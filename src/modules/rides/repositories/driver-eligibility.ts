// Internal SQL fragments only; no request input is interpolated into this definition.
// All aliases are fixed dp/u/v. Acceptance may exclude its own pending offer.
export function driverEligibilitySql(freshAfter: string, pendingRideException?: string) {
  return `u.status = 'active'
    AND dp.verification_status = 'approved'
    AND dp.availability_status = 'available'
    AND dp.last_location IS NOT NULL
    AND dp.last_location_at >= ${freshAfter}
    AND v.driver_profile_id = dp.id
    AND v.is_active = TRUE
    AND v.verification_status = 'approved'
    AND (dp.active_vehicle_id IS NULL OR dp.active_vehicle_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM rides active_ride
      WHERE active_ride.assigned_driver_id = dp.id
        AND active_ride.status NOT IN ('completed','cancelled'))
    AND NOT EXISTS (SELECT 1 FROM rides pending_offer
      WHERE pending_offer.dispatch_driver_id = dp.id
        AND pending_offer.dispatch_expires_at > NOW()
        AND pending_offer.status = 'searching'
        ${pendingRideException ? `AND pending_offer.id <> ${pendingRideException}` : ''})`;
}
