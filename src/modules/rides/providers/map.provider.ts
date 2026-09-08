export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
}

export interface MapProvider {
  calculateRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult | null>;
  calculateMatrix(origins: Coordinates[], destination: Coordinates): Promise<RouteResult[]>;
  geocode(address: string): Promise<Coordinates | null>;
  places(query: string): Promise<PlaceSuggestion[]>;
}
