// Chauffeured rentals reuse the approved passenger inventory without moving records.
export const RENTAL_VEHICLE_CODES = ['hatchback', 'sedan', 'innova', 'mini'] as const;
export function bookingInventorySector(sector?: string): string | undefined {
  return sector === 'rental' ? 'passenger' : sector;
}
export function isRentalVehicleCode(code: string): boolean {
  return (RENTAL_VEHICLE_CODES as readonly string[]).includes(code);
}
