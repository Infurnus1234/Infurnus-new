// Chauffeured rentals reuse the approved passenger inventory without moving records.
// Initial inventory identifiers retained for historical lifecycle regression coverage.
// Selection and pricing eligibility use the Admin-managed catalog, not this list.
export const RENTAL_VEHICLE_CODES = ['hatchback', 'sedan', 'innova', 'mini'] as const;
export function bookingInventorySector(sector?: string): string | undefined {
  return sector === 'rental' ? 'passenger' : sector;
}
