import { env, envSchema } from '../../../config/env.js';
import { describe, expect, it, vi } from 'vitest';
import { acquireBackendInstance, pool } from '../../../infrastructure/database/postgres.js';
import { remediateRouteContent, runGoogleMapSmoke } from '../map-operations.js';

describe('operator safeguards', () => {
  it('requires owner approval and explicit IDs before remediation writes', async () => {
    const query = vi.fn();
    await expect(
      remediateRouteContent({ query } as never, ['11111111-1111-4111-8111-111111111111'], true),
    ).rejects.toThrow('OWNER_REMEDIATION_APPROVAL_REQUIRED');
    expect(query).not.toHaveBeenCalled();
    await expect(remediateRouteContent({ query } as never, [])).rejects.toThrow();
  });
  it('requires an explicitly trusted live key before loading the provider', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(
        runGoogleMapSmoke({
          key: '',
          origin: { latitude: 0, longitude: 0 },
          destination: { latitude: 0, longitude: 0 },
          address: 'fixture',
          query: 'fixture',
        }),
      ).rejects.toThrow('TRUSTED_GOOGLE_CREDENTIAL_REQUIRED');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});

(process.env.RIDE_DB_TESTS === 'true' ? describe : describe.skip)(
  'real PostgreSQL single serving-instance guard',
  () => {
    it('rejects another instance, releases ownership, and permits restart', async () => {
      const release = await acquireBackendInstance(() => {});
      try {
        await expect(acquireBackendInstance(() => {})).rejects.toMatchObject({
          code: 'BACKEND_SINGLE_INSTANCE_REQUIRED',
        });
      } finally {
        await release();
      }
      const restarted = await acquireBackendInstance(() => {});
      await restarted();
    });
    it('detects termination of its owning session and allows reconstructed ownership', async () => {
      const lost = vi.fn();
      const release = await acquireBackendInstance(lost);
      try {
        const owner = await pool.query<{ pid: number }>(
          "SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=874011 AND granted",
        );
        expect(owner.rows).toHaveLength(1);
        await pool.query('SELECT pg_terminate_backend($1)', [owner.rows[0]!.pid]);
        await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
        const restarted = await acquireBackendInstance(() => {});
        await restarted();
      } finally {
        await release();
      }
    });
  },
);

it('runs the live-smoke operations through the common provider with mocked HTTP and no content in its result', async () => {
  const point = { latitude: 0, longitude: 0 };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    let body: unknown;
    if (url.pathname.includes('directions'))
      body = {
        status: 'OK',
        routes: [
          {
            legs: [{ distance: { value: 1112 }, duration: { value: 120 } }],
            overview_polyline: { points: '???o}@' },
          },
        ],
      };
    else if (url.pathname.includes('distancematrix'))
      body = {
        status: 'OK',
        rows: [
          { elements: [{ status: 'OK', distance: { value: 1112 }, duration: { value: 120 } }] },
        ],
      };
    else if (url.pathname.includes('autocomplete'))
      body = {
        status: 'OK',
        predictions: [{ place_id: 'fixture', description: 'Fixture address' }],
      };
    else
      body = {
        status: 'OK',
        results: [
          { formatted_address: 'Fixture address', geometry: { location: { lat: 0, lng: 0 } } },
        ],
      };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const end = vi.spyOn(pool, 'end').mockResolvedValue(undefined);
  try {
    const result = await runGoogleMapSmoke({
      key: 'private-fixture-key',
      origin: point,
      destination: { latitude: 0, longitude: 0.01 },
      address: 'Patna',
      query: 'Patna',
    });
    expect(result).toEqual({
      geocode: true,
      search: true,
      reverse: true,
      route: true,
      matrix: true,
      externalRequests: 6,
    });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(result)).not.toContain('private-fixture-key');
    expect(JSON.stringify(result)).not.toContain('Fixture address');
    fetcher.mockClear();
    await expect(
      runGoogleMapSmoke({
        key: 'private-fixture-key',
        origin: { latitude: 91, longitude: 0 },
        destination: point,
        address: 'Patna',
        query: 'Patna',
      }),
    ).rejects.toMatchObject({ code: 'MAP_INPUT_INVALID' });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
    end.mockRestore();
  }
});

it('validates bounded provider timeouts, candidate counts and request-lock budgets', () => {
  const configuration = { ...env, MAP_DRIVER_RADII_METERS: env.MAP_DRIVER_RADII_METERS.join(',') };
  const badBudget = envSchema.safeParse({
    ...configuration,
    GOOGLE_REQUEST_TIMEOUT_MS: 10000,
    GOOGLE_MAX_RETRIES: 3,
    MAP_REQUEST_LOCK_MS: 20000,
  });
  expect(badBudget.success).toBe(false);
  if (!badBudget.success)
    expect(badBudget.error.issues.map((issue) => issue.path.join('.'))).toContain(
      'MAP_REQUEST_LOCK_MS',
    );
  expect(
    envSchema.safeParse({
      ...configuration,
      GOOGLE_REQUEST_TIMEOUT_MS: 10000,
      GOOGLE_MAX_RETRIES: 3,
      MAP_REQUEST_LOCK_MS: 41000,
    }).success,
  ).toBe(true);
  expect(envSchema.safeParse({ ...configuration, MAX_DRIVER_MATCH_CANDIDATES: 26 }).success).toBe(
    false,
  );
  expect(envSchema.safeParse({ ...configuration, GOOGLE_REQUEST_TIMEOUT_MS: 10001 }).success).toBe(
    false,
  );
});
