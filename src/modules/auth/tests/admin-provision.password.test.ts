import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { provisionAdministrativeAccount } from '../services/admin-provision.service.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

it('an explicitly corrected password replaces both credential hashes without accepting the previous password', async () => {
  const previous = 'Previous-disposable-fixture!';
  const corrected = 'Corrected-disposable-fixture!';
  const previousHash = await hashPassword(previous);
  expect(await verifyPassword(previousHash, corrected)).toBe(false);
  const stored = new Map<string, string>();
  const query = vi.fn(async (sql: string, values?: string[]) => {
    if (sql.startsWith('SELECT id,role'))
      return {
        rows: [{ id: 'fixture-owner', role: 'super_admin', status: 'active', deleted_at: null }],
      };
    if (sql.startsWith('SELECT password_hash')) return { rows: [{ password_hash: previousHash }] };
    for (const table of ['user_credentials', 'admin_credentials'])
      if (sql.startsWith(`INSERT INTO ${table}`)) stored.set(table, values![1]!);
    return { rows: [] };
  });
  const database = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
  const result = await provisionAdministrativeAccount(database, {
    email: 'owner@example.invalid',
    password: corrected,
    role: 'super_admin',
    firstName: '',
    lastName: '',
    reconciliation: {
      expectedUserId: 'fixture-owner',
      expectedRole: 'super_admin',
      resetPassword: true,
    },
  });
  expect(result).toEqual({ id: 'fixture-owner', role: 'super_admin', created: false });
  for (const table of ['user_credentials', 'admin_credentials']) {
    expect(stored.get(table)).not.toBe(corrected);
    expect(await verifyPassword(stored.get(table)!, corrected)).toBe(true);
    expect(await verifyPassword(stored.get(table)!, previous)).toBe(false);
  }
  expect(stored.get('user_credentials')).toBe(stored.get('admin_credentials'));
  expect(query).toHaveBeenCalledWith('COMMIT');
});
