import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../../app.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'https://malicious.example.com';

describe('Auth CORS protection', () => {
  const app = createApp();

  it('allows the configured frontend origin', async () => {
    const response = await request(app)
      .options('/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('allows credentials for the configured frontend origin', async () => {
    const response = await request(app)
      .options('/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow a disallowed origin', async () => {
    const response = await request(app)
      .options('/auth/login')
      .set('Origin', DISALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns CORS headers for an allowed actual request', async () => {
    const response = await request(app).get('/health').set('Origin', ALLOWED_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not return the allowed-origin header for a disallowed actual request', async () => {
    const response = await request(app).get('/health').set('Origin', DISALLOWED_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
