import type { Coordinates } from '../rides/providers/map.provider.js';
import type { Pool } from 'pg';
import { z } from 'zod';

export async function runGoogleMapSmoke(settings: {
  key: string;
  origin: Coordinates;
  destination: Coordinates;
  address: string;
  query: string;
}) {
  if (!settings.key.trim()) throw new Error('TRUSTED_GOOGLE_CREDENTIAL_REQUIRED');
  // Explicit key only: never fall back to a key found in a checked-out .env file.
  const [{ CommonMapService }, { GoogleMapsProvider }, { decodePolyline }] = await Promise.all([
    import('./map.service.js'),
    import('../rides/providers/google.maps.provider.js'),
    import('./geometry.js'),
  ]);
  const maps = new CommonMapService(
    new GoogleMapsProvider(settings.key, fetch),
    undefined,
    undefined,
    Date.now,
    () => {},
  );
  const { pool } = await import('../../infrastructure/database/postgres.js');
  try {
    await maps.assertServiceArea([settings.origin, settings.destination]);
    if (settings.address.trim().length < 3 || !settings.query.trim().length)
      throw new Error('SMOKE_INPUT_REQUIRED');
    const geocode = await maps.geocode(settings.address);
    const search = await maps.places(settings.query);
    const reverse = await maps.reverseGeocode(settings.origin);
    const route = await maps.calculateRoute(settings.origin, settings.destination);
    const matrix = await maps.calculateMatrix([settings.origin], settings.destination);
    if (
      !geocode ||
      !search.length ||
      !reverse ||
      !route ||
      !matrix[0]?.route ||
      !route.encodedPolyline ||
      decodePolyline(route.encodedPolyline).length < 2
    )
      throw new Error('GOOGLE_SMOKE_RESULT_UNAVAILABLE');
    // No keys, locations, IDs, descriptions, polylines or raw provider URLs in output.
    return {
      geocode: true,
      search: true,
      reverse: true,
      route: true,
      matrix: true,
      externalRequests: Object.values(maps.hourlyUsage()).reduce((a, b) => a + b, 0),
    };
  } finally {
    await pool.end();
  }
}

const idsSchema = z.array(z.string().uuid()).min(1).max(100);
/** Explicit owner-selected terminal rides only; dry-run is the default. */
export async function remediateRouteContent(
  database: Pool,
  rideIds: string[],
  apply = false,
  approved = false,
) {
  const ids = idsSchema.parse(rideIds);
  if (apply && !approved) throw new Error('OWNER_REMEDIATION_APPROVAL_REQUIRED');
  if (!apply) {
    const result = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM rides WHERE id=ANY($1::uuid[])
       AND status IN ('completed','cancelled') AND route_metadata ? 'route'`,
      [ids],
    );
    return { mode: 'dry-run', eligible: result.rows[0]!.count, changed: 0 };
  }
  // Never erase the JSONB document or business/GPS fields. Apply is terminal-only
  // and checks eligibility atomically; it does not infer historical provenance.
  const result = await database.query(
    `UPDATE rides SET route_metadata=route_metadata - ARRAY['route','etaSeconds']::text[], updated_at=NOW()
     WHERE id=ANY($1::uuid[]) AND status IN ('completed','cancelled') AND route_metadata ? 'route'`,
    [ids],
  );
  return { mode: 'apply', changed: result.rowCount ?? 0 };
}

export const parseRouteRemediationIds = (input: unknown) => idsSchema.parse(input);
