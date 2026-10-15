/** Administrative reports use Indian calendar dates, independent of PostgreSQL TimeZone. */
export const REPORTING_TIME_ZONE = 'Asia/Kolkata';
export function reportingDatePredicates(
  column: string,
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
): string[] {
  const predicates: string[] = [];
  if (from) {
    values.push(from);
    predicates.push(
      `${column} >= ($${values.length}::date::timestamp AT TIME ZONE '${REPORTING_TIME_ZONE}')`,
    );
  }
  if (to) {
    values.push(to);
    predicates.push(
      `${column} < (($${values.length}::date + INTERVAL '1 day') AT TIME ZONE '${REPORTING_TIME_ZONE}')`,
    );
  }
  return predicates;
}
