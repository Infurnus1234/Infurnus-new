export function requireDisposableAdministrativeDatabase(): void {
  const url = new URL(process.env.DATABASE_URL!);
  const ownedLocal = /^\/admin_master_test_[a-f0-9]{32}$/.test(url.pathname);
  const ownedCi =
    process.env.CI === 'true' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    url.pathname === '/infurnus';
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5434' ||
    !(ownedLocal || ownedCi)
  ) {
    throw Error('Owned disposable administrative test database required');
  }
}
