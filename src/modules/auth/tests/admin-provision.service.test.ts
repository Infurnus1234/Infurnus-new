import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { provisionAdministrativeAccount } from '../services/admin-provision.service.js';
vi.mock('../utils/password.js', () => ({
  hashPassword: vi.fn(async () => 'fixture-hash'),
  verifyPassword: vi.fn(async () => false),
}));
function fixture(role = 'customer') {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.startsWith('SELECT id,role')
      ? [{ id: 'approved-id', role, status: 'active', deleted_at: null }]
      : sql.startsWith('SELECT password_hash')
        ? [{ password_hash: 'old-fixture-hash' }]
        : [],
  }));
  const release = vi.fn();
  return { query, release, pool: { connect: async () => ({ query, release }) } as unknown as Pool };
}
const input = {
  email: 'owner@example.invalid',
  password: 'disposable-fixture',
  role: 'super_admin' as const,
  firstName: 'Test',
  lastName: 'Owner',
};
describe('operator administrative reconciliation', () => {
  it('never creates a replacement when the expected identity is missing', async () => {
    const f = fixture();
    f.query.mockResolvedValue({ rows: [] });
    await expect(
      provisionAdministrativeAccount(f.pool, {
        ...input,
        reconciliation: {
          expectedUserId: 'approved-id',
          expectedRole: 'customer',
          resetPassword: true,
        },
      }),
    ).rejects.toThrow(/missing/);
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.anything(),
    );
  });
  it('does not promote an existing customer without explicit reconciliation', async () => {
    const f = fixture();
    await expect(provisionAdministrativeAccount(f.pool, input)).rejects.toThrow(/reconciliation/);
    expect(f.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      expect.anything(),
    );
  });
  it.each([
    { expectedUserId: 'other-id', expectedRole: 'customer', resetPassword: true },
    { expectedUserId: 'approved-id', expectedRole: 'driver', resetPassword: true },
  ])('refuses a changed identity or role', async (reconciliation) => {
    const f = fixture();
    await expect(
      provisionAdministrativeAccount(f.pool, { ...input, reconciliation }),
    ).rejects.toThrow(/reconciliation/);
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('requires explicit password-reset authorization for a mismatched hash', async () => {
    const f = fixture();
    await expect(
      provisionAdministrativeAccount(f.pool, {
        ...input,
        reconciliation: {
          expectedUserId: 'approved-id',
          expectedRole: 'customer',
          resetPassword: false,
        },
      }),
    ).rejects.toThrow(/password reset/);
  });
  it('repairs only the approved account, hashes credentials, revokes sessions and records an audit event', async () => {
    const f = fixture();
    expect(
      await provisionAdministrativeAccount(f.pool, {
        ...input,
        reconciliation: {
          expectedUserId: 'approved-id',
          expectedRole: 'customer',
          resetPassword: true,
        },
      }),
    ).toEqual({ id: 'approved-id', role: 'super_admin', created: false });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_credentials'), [
      'approved-id',
      'fixture-hash',
    ]);
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE refresh_tokens'), [
      'approved-id',
    ]);
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE login_challenges'), [
      'approved-id',
    ]);
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('ADMIN_ACCOUNT_RECONCILED'), [
      'approved-id',
      expect.not.stringContaining(input.password),
    ]);
    expect(f.query).toHaveBeenCalledWith('COMMIT');
    expect(f.release).toHaveBeenCalled();
  });
});
