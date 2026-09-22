import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import * as dbModule from '../infrastructure/database/postgres.js';

describe('Health & Readiness endpoints', () => {
  it('GET /health returns 200 OK', async () => {
    const app = createApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'ok',
      },
    });
  });

  it('GET /health/ready returns 200 when DB readiness succeeds', async () => {
    const checkDbSpy = vi.spyOn(dbModule, 'checkDatabaseConnection').mockResolvedValueOnce();

    const app = createApp();

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'ok',
      },
    });

    checkDbSpy.mockRestore();
  });

  it('GET /health/ready returns 503 when DB readiness fails', async () => {
    const checkDbSpy = vi
      .spyOn(dbModule, 'checkDatabaseConnection')
      .mockRejectedValueOnce(new Error('Database connection failed'));

    const app = createApp();

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
      },
    });

    checkDbSpy.mockRestore();
  });
});
