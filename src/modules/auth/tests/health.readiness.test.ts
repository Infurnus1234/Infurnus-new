import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';

describe('Health & Readiness Probes & Body Limit', () => {
  it('GET /health returns 200 with liveness status and uptime', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptime).toBe('number');
  });

  it('GET /health/ready returns 200 when readiness probe passes', async () => {
    const app = createApp({} as never, undefined, { readinessCheck: async () => true });
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ready).toBe(true);
    expect(res.body.data.database).toBe('connected');
  });

  it('GET /ready alias also routes to readiness probe', async () => {
    const app = createApp({} as never, undefined, { readinessCheck: async () => true });
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ready).toBe(true);
  });

  it('GET /health/ready returns 503 when readiness probe fails', async () => {
    const app = createApp({} as never, undefined, { readinessCheck: async () => false });
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('rejects oversized JSON request bodies (> 1MB)', async () => {
    const app = createApp();
    // 1.2 MB string payload
    const bigPayload = { data: 'a'.repeat(1200000) };

    const res = await request(app).post('/auth/login').send(bigPayload);

    // Express 5 body-parser throws 413 Payload Too Large
    expect(res.status).toBe(413);
  });
});
