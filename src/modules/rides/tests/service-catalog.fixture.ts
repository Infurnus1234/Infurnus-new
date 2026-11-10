import type { Pool } from 'pg';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
export type ServiceFixtureSnapshots = Map<string, Record<string, unknown> | null>;
export async function configureServiceFixture(
  pool: Pool,
  code: string,
  snapshots: ServiceFixtureSnapshots,
) {
  requireDisposableAdministrativeDatabase();
  if (snapshots.has(code)) return;
  snapshots.set(
    code,
    (await pool.query("SELECT * FROM vehicle_types WHERE sector='service' AND code=$1", [code]))
      .rows[0] ?? null,
  );
  await pool.query(
    `INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise,active,service_fixed_fare_paise,service_radius_meters) VALUES($1,$1,'service',NULL,NULL,TRUE,10000,25000)
    ON CONFLICT(sector,code) DO UPDATE SET base_fare_paise=NULL,per_km_rate_paise=NULL,pricing_reference=NULL,hourly_base_fares_paise=NULL,logistics_slabs=NULL,active=TRUE,service_fixed_fare_paise=10000,service_radius_meters=25000`,
    [code],
  );
}
export async function restoreServiceFixtures(pool: Pool, snapshots: ServiceFixtureSnapshots) {
  for (const [code, old] of snapshots) {
    if (!old)
      await pool.query("DELETE FROM vehicle_types WHERE sector='service' AND code=$1", [code]);
    else
      await pool.query(
        'UPDATE vehicle_types SET active=$2,base_fare_paise=$3,per_km_rate_paise=$4,pricing_reference=$5::jsonb,service_fixed_fare_paise=$6,service_radius_meters=$7 WHERE id=$1',
        [
          old.id,
          old.active,
          old.base_fare_paise,
          old.per_km_rate_paise,
          old.pricing_reference == null ? null : JSON.stringify(old.pricing_reference),
          old.service_fixed_fare_paise,
          old.service_radius_meters,
        ],
      );
  }
  snapshots.clear();
}
