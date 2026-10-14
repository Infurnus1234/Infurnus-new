// Only supported operations are grantable. No wildcard or self-administration grant exists.
export const permissionCatalog = [
  'dashboard.read',
  'users.read',
  'users.detail',
  'users.update',
  'users.sensitive',
  'drivers.read',
  'drivers.detail',
  'drivers.documents',
  'drivers.sensitive',
  'drivers.verify',
  'partners.read',
  'partners.detail',
  'partners.sensitive',
  'partners.documents',
  'vehicles.read',
  'vehicles.detail',
  'vehicles.create',
  'vehicles.update',
  'vehicles.deactivate',
  'vehicles.verify',
  'documents.verify',
  'pricing.read',
  'pricing.create',
  'pricing.update',
  'fleet.read',
  'fleet.detail',
  'approvals.read',
  'approvals.detail',
  'approvals.documents',
  'approvals.sensitive',
  'approvals.approve',
  'approvals.reject',
  'rides.read',
  'logistics.read',
  'rentals.read',
  'payments.read',
  'wallets.read',
  'transactions.read',
  'settlements.read',
  'commission.read',
  'refunds.read',
  'coupons.read',
  'coupons.create',
  'coupons.update',
  'support.read',
  'support.update',
  'notifications.read',
  'activity.read',
  'reports.read',
  'maps.read',
] as const;
export type AdminPermissionKey = (typeof permissionCatalog)[number];
export function requiredPermissions(
  method: string,
  rawPath: string,
  body?: { status?: string },
): string[] | null {
  const path = rawPath.replace(/\/+$/, '');
  if (path === '/admin/access/me') return method === 'GET' ? [] : null;
  if (/^\/auth\/(logout|logout-all|refresh|sessions(?:\/[^/]+)?|change-password)$/.test(path))
    return [];
  if (path === '/admin/dashboard') return method === 'GET' ? ['dashboard.read'] : null;
  if (path === '/admin/operations/summary') return method === 'GET' ? ['reports.read'] : null;
  const operation = path.match(/^\/admin\/operations\/([^/]+)(?:\/[^/]+\/(status|active))?$/);
  if (operation) {
    const resource = operation[1];
    if (method === 'GET' && !operation[2]) return [`${resource}.read`];
    if (resource === 'coupons' && method === 'POST') return ['coupons.read', 'coupons.create'];
    if (resource === 'coupons' && method === 'PATCH') return ['coupons.read', 'coupons.update'];
    if (resource === 'support' && method === 'PATCH') return ['support.read', 'support.update'];
    return null;
  }
  if (/^\/maps\/(geocode|route)$/.test(path))
    return method === 'POST' ? ['maps.read', 'fleet.read'] : null;
  if (/^\/admin\/reports\//.test(path)) return method === 'GET' ? ['reports.read'] : null;
  if (/^\/partners(?:\/[^/]+(?:\/documents(?:\/[^/]+)?)?)?$/.test(path) && method === 'GET')
    return [
      'partners.read',
      ...(path.includes('/documents')
        ? ['partners.detail', 'partners.documents']
        : path !== '/partners'
          ? ['partners.detail']
          : []),
    ];
  if (/^\/admin\/(drivers|vehicles|documents)\/[^/]+\/verify$/.test(path) && method === 'POST') {
    const resource = path.split('/')[2]!;
    return [
      `${resource}.verify`,
      ...(resource === 'documents' ? [] : [`${resource}.read`, `${resource}.detail`]),
    ];
  }
  if (/^\/admin\/fleet\//.test(path))
    return method === 'GET'
      ? ['fleet.read', ...(path.match(/\/vehicles\/[^/]+$/) ? ['fleet.detail'] : [])]
      : null;
  if (/^\/admin\/vehicle-types(?:\/[^/]+(?:\/status)?)?$/.test(path)) {
    if (method === 'GET') return ['pricing.read'];
    if (method === 'POST') return ['pricing.read', 'pricing.create'];
    if (method === 'PATCH') return ['pricing.read', 'pricing.update'];
    return null;
  }
  if (/^\/vehicles(?:\/[^/]+(?:\/deactivate)?)?$/.test(path)) {
    if (method === 'GET')
      return ['vehicles.read', ...(path === '/vehicles' ? [] : ['vehicles.detail'])];
    if (method === 'POST' && path === '/vehicles') return ['vehicles.read', 'vehicles.create'];
    if (method === 'POST' && path.endsWith('/deactivate'))
      return ['vehicles.read', 'vehicles.deactivate'];
    if (method === 'PATCH') return ['vehicles.read', 'vehicles.update'];
    return null;
  }
  if (
    /^\/provider-approvals(?:\/[^/]+(?:\/review|\/documents\/[^/]+\/access-url)?)?$/.test(path) ||
    /^\/admin\/drivers\/applications/.test(path) ||
    /^\/driver-applications\/[^/]+\/review$/.test(path)
  ) {
    if (method === 'POST' && path.endsWith('/review'))
      return [
        'approvals.read',
        'approvals.detail',
        body?.status === 'APPROVED' ? 'approvals.approve' : 'approvals.reject',
      ];
    if (method !== 'GET') return null;
    return [
      'approvals.read',
      ...(path.includes('access-url')
        ? ['approvals.detail', 'approvals.documents']
        : path.match(/^\/provider-approvals\/[^/]+$/) ||
            path.match(/^\/admin\/drivers\/applications\/[^/]+$/)
          ? ['approvals.detail']
          : []),
    ];
  }
  const entity = path.match(
    /^\/admin\/(users|drivers|partners|vehicles)(?:\/([^/]+)(?:\/(.*))?)?$/,
  );
  if (entity) {
    const resource = entity[1];
    if (method === 'GET')
      return [
        `${resource}.read`,
        ...(entity[2] ? [`${resource}.detail`] : []),
        ...(entity[3]?.includes('access-url') ? [`${resource}.documents`] : []),
      ];
    if (method === 'PATCH' && resource === 'users' && entity[3] === 'status')
      return ['users.read', 'users.update'];
  }
  // Legacy verification and unknown/new endpoints are denied until their contracts are reviewed.
  return null;
}
