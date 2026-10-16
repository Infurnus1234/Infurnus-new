import type { Pool } from 'pg';

const deletedSubjects = new Set<string>();
export function revokeDeletedSubject(id: string) {
  deletedSubjects.add(id);
}
export function isDeletedSubject(id: string) {
  return deletedSubjects.has(id);
}

// The backend already permits only one serving process per database. Restore this
// deny-list after taking ownership, before HTTP/socket handlers become active.
export async function loadDeletedSubjects(database: Pick<Pool, 'query'>) {
  const result = await database.query<{ id: string }>(
    `SELECT DISTINCT metadata->>'deletedSubjectId' AS id FROM user_history
     WHERE event_type='ADMIN_RECORD_DELETED' AND metadata ? 'deletedSubjectId'`,
  );
  deletedSubjects.clear();
  for (const row of result.rows) deletedSubjects.add(row.id);
}
