import { pathToFileURL } from 'node:url';
import type { Coordinates } from '../src/modules/rides/providers/map.provider.js';
import { runGoogleMapSmoke } from '../src/modules/maps/map-operations.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const key = process.env.INFURNUS_TRUSTED_GOOGLE_MAPS_KEY;
    if (!process.argv.includes('--live') || !key)
      throw new Error('TRUSTED_GOOGLE_CREDENTIAL_REQUIRED');
    process.env.GOOGLE_MAX_RETRIES = '0'; // Controlled smoke: at most one HTTP attempt per operation.
    const origin = JSON.parse(process.env.INFURNUS_MAP_SMOKE_ORIGIN ?? '') as Coordinates;
    const destination = JSON.parse(process.env.INFURNUS_MAP_SMOKE_DESTINATION ?? '') as Coordinates;
    const result = await runGoogleMapSmoke({
      key,
      origin,
      destination,
      address: process.env.INFURNUS_MAP_SMOKE_ADDRESS ?? '',
      query: process.env.INFURNUS_MAP_SMOKE_QUERY ?? '',
    });
    console.log(JSON.stringify({ event: 'google_map_smoke', ...result }));
  } catch {
    console.error(
      JSON.stringify({
        event: 'google_map_smoke_failed',
        reason:
          'Check trusted credential, approved coverage, inputs and provider account; no sensitive details logged',
      }),
    );
    process.exitCode = 1;
  }
}
