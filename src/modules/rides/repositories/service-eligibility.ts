import { serviceArea } from '../../maps/service-area.js';

/** Fixed SQL aliases only. Shared by offer and atomic acceptance, never client input. */
export function serviceEligibilitySql(pickup = 'r.pickup_location') {
  const boundary = serviceArea.boundaryGeoJson;
  const coverage = boundary
    ? `ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON('${boundary.replaceAll("'", "''")}'),4326),dp.last_location::geometry)`
    : serviceArea.required
      ? 'FALSE'
      : 'TRUE';
  return `${coverage} AND EXISTS (SELECT 1 FROM vehicle_types service_type
    WHERE service_type.sector='service' AND service_type.code=v.category AND service_type.active
      AND service_type.service_fixed_fare_paise IS NOT NULL
      AND ST_DWithin(dp.last_location,${pickup},service_type.service_radius_meters + 0.000001))`;
}
