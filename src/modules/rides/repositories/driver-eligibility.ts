// Internal SQL fragments only; no request input is interpolated into this definition.
// All aliases are fixed dp/u/v. Acceptance may exclude its own pending offer.
export function driverOperationalEligibilitySql(selectOwned = false) {
  return `u.status = 'active' AND u.deleted_at IS NULL
    AND u.role IN ('driver','driver_fleet_owner')
    AND dp.verification_status = 'approved' AND dp.license_expiry >= CURRENT_DATE
    AND ${selectOwned ? '(v.driver_profile_id=dp.id OR (v.owner_id=dp.user_id AND v.driver_profile_id IS NULL))' : 'dp.active_vehicle_id = v.id AND v.driver_profile_id = dp.id'}
    AND v.is_active = TRUE AND v.verification_status = 'approved'
    AND (v.registration_expiry IS NULL OR v.registration_expiry >= CURRENT_DATE)
    AND (v.owner_id = dp.user_id OR EXISTS (
      SELECT 1 FROM partners p JOIN partner_drivers pd ON pd.partner_id=p.id
      WHERE p.user_id=v.owner_id AND p.approval_status='approved'
        AND pd.driver_profile_id=dp.id AND pd.status='ACTIVE'))
    AND provider_compliance_satisfied(dp.user_id,dp.id,
      (SELECT p.id FROM partners p WHERE p.user_id=dp.user_id),v.id,v.category)`;
}

export function driverEligibilitySql(freshAfter: string, pendingRideException?: string) {
  return `${driverOperationalEligibilitySql()}
    AND dp.availability_status = 'available'
    AND dp.last_location IS NOT NULL
    AND dp.last_location_at >= ${freshAfter}
    AND NOT EXISTS (SELECT 1 FROM rides active_ride
      WHERE active_ride.assigned_driver_id = dp.id
        AND active_ride.status NOT IN ('completed','cancelled'))
    AND NOT EXISTS (SELECT 1 FROM rides pending_offer
      WHERE pending_offer.dispatch_driver_id = dp.id
        AND pending_offer.dispatch_expires_at > NOW()
        AND pending_offer.status = 'searching'
        ${pendingRideException ? `AND pending_offer.id <> ${pendingRideException}` : ''})`;
}
