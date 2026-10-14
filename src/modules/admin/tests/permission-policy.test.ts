import { describe, expect, it } from 'vitest';
import { permissionCatalog, requiredPermissions } from '../services/permission-policy.js';
import { createAdminSchema } from '../services/admin-management.service.js';
import { redactContactData } from '../middleware/permission.middleware.js';
describe('default-deny administrative policy', () => {
  it('does not permit management, unknown APIs, legacy bypass or unsupported delete', () => {
    for (const [method, path] of [
      ['POST', '/admin/access/admins'],
      ['DELETE', '/vehicles/id'],
      ['GET', '/provider/private'],
      ['GET', '/%61dmin/users'],
    ])
      expect(requiredPermissions(method!, path!)).toBeNull();
  });
  it('separates list, details, private documents and mutations', () => {
    expect(requiredPermissions('GET', '/admin/drivers')).toEqual(['drivers.read']);
    expect(requiredPermissions('GET', '/admin/drivers/id')).toEqual([
      'drivers.read',
      'drivers.detail',
    ]);
    expect(requiredPermissions('GET', '/admin/drivers/id/documents/doc/access-url')).toEqual([
      'drivers.read',
      'drivers.detail',
      'drivers.documents',
    ]);
    expect(requiredPermissions('GET', '/admin/drivers/applications/id')).toEqual([
      'approvals.read',
      'approvals.detail',
    ]);
    expect(requiredPermissions('POST', '/vehicles')).toEqual(['vehicles.read', 'vehicles.create']);
    expect(requiredPermissions('PATCH', '/vehicles/id')).toEqual([
      'vehicles.read',
      'vehicles.update',
    ]);
    expect(requiredPermissions('POST', '/admin/drivers/id/verify')).toEqual([
      'drivers.verify',
      'drivers.read',
      'drivers.detail',
    ]);
  });
  it('separates approve and reject privileges', () => {
    expect(
      requiredPermissions('POST', '/provider-approvals/id/review', { status: 'APPROVED' }),
    ).toContain('approvals.approve');
    expect(
      requiredPermissions('POST', '/provider-approvals/id/review', { status: 'REJECTED' }),
    ).toContain('approvals.reject');
  });
  it('defaults new accounts to no permissions and rejects escalation input', () => {
    const valid = {
      email: ' Test@Example.invalid ',
      password: 'Local-test-only-123!',
      firstName: 'Test',
      lastName: 'Admin',
    };
    expect(createAdminSchema.parse(valid).permissions).toEqual([]);
    expect(createAdminSchema.parse(valid).email).toBe('test@example.invalid');
    for (const invalid of [
      { ...valid, role: 'super_admin' },
      { ...valid, password: 'short' },
      { ...valid, permissions: ['admins.create'] },
      { ...valid, permissions: ['users.read', 'users.read'] },
    ])
      expect(() => createAdminSchema.parse(invalid)).toThrow();
    expect(permissionCatalog).not.toContain('admins.create');
  });
  it('redacts nested contact details without changing media access or counts', () => {
    expect(
      redactContactData({
        data: {
          items: [
            {
              id: 'a',
              email: 'private',
              phone: 'private',
              firstName: 'Name',
              documents: [{ accessUrl: 'authorized', contact: 'private' }],
            },
          ],
          total: 1,
        },
      }),
    ).toEqual({
      data: {
        items: [{ id: 'a', firstName: 'Name', documents: [{ accessUrl: 'authorized' }] }],
        total: 1,
      },
    });
  });
});
