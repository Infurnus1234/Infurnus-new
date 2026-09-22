import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import * as dbModule from '../infrastructure/database/postgres.js';

describe('Health & Readiness endpoints', () => {
  it('GET /health returns 200 OK', async () => {
    const app = createApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(typeof response.body.data.uptime).toBe('number');
  });

  it('GET /health/ready returns 200 when DB readiness succeeds', async () => {
    const checkDbSpy = vi.spyOn(dbModule, 'checkDatabaseConnection').mockResolvedValueOnce();

    const app = createApp();

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.ready).toBe(true);

    checkDbSpy.mockRestore();
  });

  it('GET /health/ready returns 503 when DB readiness fails', async () => {
    const readinessCheck = vi.fn().mockResolvedValueOnce(false);

    const app = createApp({} as any, undefined, {
      readinessCheck,
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database check failed',
      },
    });
  });
});
