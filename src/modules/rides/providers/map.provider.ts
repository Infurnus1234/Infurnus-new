export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
}

export interface MatrixRouteResult {
  origin: Coordinates;
  route: RouteResult | null;
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
}

export interface ReverseGeocodeResult {
  address: string;
  placeId?: string;
  coordinates: Coordinates;
}
export interface MapRequestOptions {
  locationBias?: Coordinates;
  mode?: 'driving' | 'walking' | 'bicycling';
  avoidTolls?: boolean;
  source?: 'RIDE' | 'LOGISTICS' | 'RENTAL' | 'USER' | 'PARTNER' | 'ADMIN';
  beforeExternalRequest?: () => Promise<void>;
  onExternalRequest?: () => void;
}

export interface MapProvider {
  forSource?(source: NonNullable<MapRequestOptions['source']>): MapProvider;
  readonly providerName?: string;
  readonly navigationStorageAllowed?: boolean;
  reverseGeocode?(
    point: Coordinates,
    options?: MapRequestOptions,
  ): Promise<ReverseGeocodeResult | null>;
  calculateRoute(
    origin: Coordinates,
    destination: Coordinates,
    options?: MapRequestOptions,
  ): Promise<RouteResult | null>;
  calculateMatrix(
    origins: Coordinates[],
    destination: Coordinates,
    options?: MapRequestOptions,
  ): Promise<MatrixRouteResult[]>;
  geocode(address: string, options?: MapRequestOptions): Promise<Coordinates | null>;
  places(query: string, options?: MapRequestOptions): Promise<PlaceSuggestion[]>;
}
