import type { Ride } from '../types/ride.js';
import type { AdministrativeDistrict, MapProvider } from '../providers/map.provider.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import { validateCoordinates } from '../../maps/geometry.js';
export interface DistrictLookup {
  name: string | null;
  resolvedAt: string;
  latitude: number;
  longitude: number;
  source: string;
}
/** Booking metadata only. Never affects coverage, dispatch, fare, acceptance or payments. */
export class LogisticsDestinationResolver {
  private pending = new Map<string, Promise<void>>();
  constructor(
    private readonly rides: RideRepository,
    private readonly maps?: Pick<MapProvider, 'resolveDistrict'>,
    private readonly now = Date.now,
  ) {}
  async prepare(ride: Ride): Promise<Ride> {
    if (ride.sector !== 'logistics' || ride.pinVerified === true || ['completed','cancelled'].includes(ride.status)) return ride;
    const prior = ride.destinationDistrictLookup;
    const same =
      prior &&
      prior.latitude === ride.destination.latitude &&
      prior.longitude === ride.destination.longitude;
    const age = prior ? this.now() - Date.parse(prior.resolvedAt) : Infinity;
    if (same && age >= 0 && age < (prior.name ? 30 * 86400000 : 60000)) {
      ride.destinationDistrict = prior.name;
      return ride;
    }
    if (!this.maps?.resolveDistrict) {
      ride.destinationDistrict = null;
      return ride;
    }
    const key = `${ride.id}:${ride.destination.latitude}:${ride.destination.longitude}`;
    let work = this.pending.get(key);
    if (work) {
      await work;
      const latest = await this.rides.findById(ride.id);
      ride.destinationDistrict = latest?.destinationDistrict ?? null;
      return ride;
    }
    work = (async () => {
      let result: AdministrativeDistrict | null = null;
      try {
        validateCoordinates(ride.destination);
        result = await this.maps!.resolveDistrict!(ride.destination, { source: 'LOGISTICS' });
      } catch {
        /* Fail closed; never fall back to address or city. */
      }
      const lookup: DistrictLookup = {
        name: result?.name ?? null,
        resolvedAt: new Date(this.now()).toISOString(),
        ...ride.destination,
        source: result?.source ?? 'unresolved',
      };
      if (this.rides.saveDestinationDistrict) {
        try {
          const saved = await this.rides.saveDestinationDistrict(ride.id, ride.destination, lookup);
          if (!saved) {
            ride.destinationDistrict = null;
            return;
          }
        } catch {
          ride.destinationDistrict = null;
          return;
        }
      }
      ride.destinationDistrict = lookup.name;
      ride.destinationDistrictLookup = lookup;
    })().finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, work);
    await work;
    return ride;
  }
}
