/** Server-side list ordering. Callers supply fixed SQL identifiers, never request values. */
export function newestFirstSql(timestamp = 'created_at', id = 'id'): string {
  const identifier = /^(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$/i;
  if (!identifier.test(timestamp) || !identifier.test(id)) {
    throw new Error('Invalid chronological ordering identifier');
  }
  return `${timestamp} DESC, ${id} DESC`;
}
