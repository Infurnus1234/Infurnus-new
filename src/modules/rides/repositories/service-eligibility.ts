import { serviceArea } from '../../maps/service-area.js';
import { CityRadiusPolicy, cityCoverageSql, cityReferences } from '../../maps/city-radius.js';
import { serviceCityAreas, type ServiceCityAreas } from '../../maps/service-city-areas.js';

const defaultBoundaries = Object.entries(cityReferences).map(
  ([id, reference]) => new CityRadiusPolicy(id, reference).boundaryGeoJson,
);

/** Fixed SQL aliases only. Shared by offer and atomic acceptance, never client input. */
export function serviceEligibilitySql(
  pickup = 'r.pickup_location',
  registry: Pick<ServiceCityAreas, 'cities'> = serviceCityAreas,
) {
  const boundary = serviceArea.boundaryGeoJson;
  const coverage = boundary
    ? `ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON('${boundary.replaceAll("'", "''")}'),4326),dp.last_location::geometry)`
    : serviceArea.required
      ? 'FALSE'
      : 'TRUE';
  const boundaries = registry.cities.length
    ? registry.cities.map(({ area }) => area.boundaryGeoJson).filter(Boolean)
    : defaultBoundaries;
  const cityJson = JSON.stringify(boundaries.map((value) => JSON.parse(value!))).replaceAll(
    "'",
    "''",
  );
  const driver = 'dp.last_location::geometry';
  const accuracy = 'LEAST(GREATEST(dp.location_accuracy,0),200)';
  return `${coverage}
    AND dp.online_preference
    AND dp.location_accuracy BETWEEN 0 AND 200
    AND (
      SELECT COUNT(*) FILTER (WHERE city.pickup_here) = 1
         AND COUNT(*) FILTER (WHERE city.driver_here) = 1
         AND COALESCE(BOOL_OR(city.pickup_here AND city.driver_here AND city.driver_inside), FALSE)
      FROM (
        SELECT ${cityCoverageSql('boundary', `(${pickup})::geometry`)} AS pickup_here,
               ${cityCoverageSql('boundary', driver)} AS driver_here,
               CASE WHEN boundary->>'type'='Point' THEN
                 ST_DWithin(ST_SetSRID(ST_GeomFromGeoJSON(boundary::text),4326)::geography,
                   dp.last_location, 25000 - ${accuracy})
               ELSE NOT ST_DWithin(ST_Boundary(ST_SetSRID(ST_GeomFromGeoJSON(boundary::text),4326))::geography,
                   dp.last_location, ${accuracy}) END AS driver_inside
        FROM jsonb_array_elements('${cityJson}'::jsonb) AS areas(boundary)
      ) city
    )
    AND EXISTS (SELECT 1 FROM vehicle_types service_type
    WHERE service_type.sector='service' AND service_type.code=v.category AND service_type.active
      AND service_type.service_fixed_fare_paise IS NOT NULL
      AND ST_DWithin(dp.last_location,${pickup},LEAST(service_type.service_radius_meters,25000) + 0.000001))`;
}
