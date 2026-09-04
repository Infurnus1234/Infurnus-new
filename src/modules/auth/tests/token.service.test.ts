import { describe, expect, it } from 'vitest';
import { TokenService } from '../services/token.service.js';
import { verifyAccessToken } from '../utils/jwt.js';

describe('TokenService', () => {
  it('creates an access token containing user identity and role', async () => {
    const service = new TokenService();

    const userId = '00000000-0000-0000-0000-000000000001';

    const token = await service.createAccessToken({
      userId,
      role: 'customer',
    });

    const payload = await verifyAccessToken(token);

    expect(payload.sub).toBe(userId);
    expect(payload.role).toBe('customer');
    expect(payload.type).toBe('access');
  });

  it('creates tokens for different roles', async () => {
    const service = new TokenService();

    const customerToken = await service.createAccessToken({
      userId: '00000000-0000-0000-0000-000000000001',
      role: 'customer',
    });

    const adminToken = await service.createAccessToken({
      userId: '00000000-0000-0000-0000-000000000002',
      role: 'admin',
    });

    const customerPayload = await verifyAccessToken(customerToken);
    const adminPayload = await verifyAccessToken(adminToken);

    expect(customerPayload.role).toBe('customer');
    expect(adminPayload.role).toBe('admin');
  });
});
