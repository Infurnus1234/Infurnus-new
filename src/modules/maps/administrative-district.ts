import type { AdministrativeDistrict } from '../rides/providers/map.provider.js';

export const BIHAR_DISTRICTS = [
  'Araria',
  'Arwal',
  'Aurangabad',
  'Banka',
  'Begusarai',
  'Bhagalpur',
  'Bhojpur',
  'Buxar',
  'Darbhanga',
  'East Champaran',
  'Gaya',
  'Gopalganj',
  'Jamui',
  'Jehanabad',
  'Kaimur',
  'Katihar',
  'Khagaria',
  'Kishanganj',
  'Lakhisarai',
  'Madhepura',
  'Madhubani',
  'Munger',
  'Muzaffarpur',
  'Nalanda',
  'Nawada',
  'Patna',
  'Purnia',
  'Rohtas',
  'Saharsa',
  'Samastipur',
  'Saran',
  'Sheikhpura',
  'Sheohar',
  'Sitamarhi',
  'Siwan',
  'Supaul',
  'Vaishali',
  'West Champaran',
] as const;
const key = (name: string) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ district$/, '')
    .replace(/[^a-z]/g, '');
const canonical = new Map<string, string>(BIHAR_DISTRICTS.map((name) => [key(name), name]));
for (const [alias, name] of Object.entries({
  purbiChamparan: 'East Champaran',
  purbaChamparan: 'East Champaran',
  pashchimChamparan: 'West Champaran',
  paschimChamparan: 'West Champaran',
  purnea: 'Purnia',
  kaimurbhabua: 'Kaimur',
  bhabua: 'Kaimur',
  jehanabad: 'Jehanabad',
  sheohar: 'Sheohar',
}))
  canonical.set(key(alias), name);
export function canonicalBiharDistrict(name: string): string | null {
  return canonical.get(key(name)) ?? null;
}
type Component = { long_name?: unknown; short_name?: unknown; types?: unknown };
/** Read typed administrative components only. Never parse the formatted address,
 * locality, postcode, nearest city, or a client-supplied district. */
export function districtFromGoogle(results: unknown): AdministrativeDistrict | null {
  if (!Array.isArray(results)) return null;
  const found = new Map<string, AdministrativeDistrict>();
  for (const result of results) {
    if (!result || !Array.isArray(result.address_components)) continue;
    const components = result.address_components as Component[];
    const component = (type: string) =>
      components.find((c) => Array.isArray(c.types) && c.types.includes(type));
    const country = component('country')?.short_name;
    const state = component('administrative_area_level_1')?.long_name;
    if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) continue;
    const levels: (2 | 3)[] = country === 'IN' ? [3, 2] : [2];
    for (const level of levels) {
      const name = component(`administrative_area_level_${level}`)?.long_name;
      if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\r\n<>]/.test(name))
        continue;
      const bihar =
        country === 'IN' && typeof state === 'string' && state.toLowerCase() === 'bihar';
      const normalized = bihar ? canonicalBiharDistrict(name) : name.trim();
      if (!normalized) continue;
      const value: AdministrativeDistrict = {
        name: normalized,
        countryCode: country,
        state: typeof state === 'string' ? state : null,
        level,
        source: 'google_geocoding',
      };
      found.set(`${country}:${state}:${normalized}`, value);
      break;
    }
  }
  // Conflicting administrative results are unresolved, rather than a guessed district.
  const candidates = [...found.values()];
  const preferred = candidates.some((d) => d.countryCode === 'IN' && d.level === 3)
    ? candidates.filter((d) => d.countryCode === 'IN' && d.level === 3)
    : candidates;
  return preferred.length === 1 ? preferred[0]! : null;
}
