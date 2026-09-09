import { env } from '../../../config/env.js';
import type {
  Coordinates,
  MapProvider,
  MatrixRouteResult,
  PlaceSuggestion,
  RouteResult,
} from './map.provider.js';

interface GoogleResponse {
  status?: string;
  routes?: Array<{
    legs?: Array<{ distance?: { value?: number }; duration?: { value?: number } }>;
    overview_polyline?: { points?: string };
  }>;
  rows?: Array<{
    elements?: Array<{
      status?: string;
      distance?: { value?: number };
      duration?: { value?: number };
    }>;
  }>;
  results?: Array<{
    place_id?: string;
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
  predictions?: Array<{ place_id?: string; description?: string }>;
}

export class GoogleMapsProvider implements MapProvider {
  private lastPlacesRequestAt = 0;

  constructor(
    private readonly apiKey: string | undefined = env.GOOGLE_MAPS_API_KEY,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly logger: (event: string, metadata: Record<string, unknown>) => void = () => {},
  ) {}

  async calculateRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult | null> {
    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/directions/json',
      {
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        key: this.apiKey,
      },
    );

    const leg = response?.routes?.[0]?.legs?.[0];

    if (!leg?.distance?.value || !leg.duration?.value) return null;

    const route: RouteResult = {
      distanceMeters: leg.distance.value,
      durationSeconds: leg.duration.value,
    };

    const encodedPolyline = response?.routes?.[0]?.overview_polyline?.points;

    if (encodedPolyline) {
      route.encodedPolyline = encodedPolyline;
    }

    return route;
  }

  async calculateMatrix(
    origins: Coordinates[],
    destination: Coordinates,
  ): Promise<MatrixRouteResult[]> {
    const boundedOrigins = origins.slice(0, env.MAX_DRIVER_MATCH_CANDIDATES);

    if (boundedOrigins.length === 0) return [];

    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        origins: boundedOrigins.map((point) => `${point.latitude},${point.longitude}`).join('|'),
        destinations: `${destination.latitude},${destination.longitude}`,
        key: this.apiKey,
      },
    );

    const elements = response?.rows?.[0]?.elements ?? [];

    return boundedOrigins.map((origin, index) => {
      const element = elements[index];

      if (
        element?.status !== 'OK' ||
        typeof element.distance?.value !== 'number' ||
        typeof element.duration?.value !== 'number'
      ) {
        return {
          origin,
          route: null,
        };
      }

      return {
        origin,
        route: {
          distanceMeters: element.distance.value,
          durationSeconds: element.duration.value,
        },
      };
    });
  }

  async geocode(address: string): Promise<Coordinates | null> {
    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/geocode/json',
      {
        address,
        key: this.apiKey,
      },
    );

    const location = response?.results?.[0]?.geometry?.location;

    if (typeof location?.lat !== 'number' || typeof location.lng !== 'number') {
      return null;
    }

    return {
      latitude: location.lat,
      longitude: location.lng,
    };
  }

  async places(query: string): Promise<PlaceSuggestion[]> {
    if (query.trim().length < env.GOOGLE_PLACES_MIN_QUERY_LENGTH) {
      return [];
    }

    if (this.now() - this.lastPlacesRequestAt < env.GOOGLE_PLACES_MIN_INTERVAL_MS) {
      return [];
    }

    this.lastPlacesRequestAt = this.now();

    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json',
      {
        input: query.trim(),
        key: this.apiKey,
      },
    );

    return (response?.predictions ?? [])
      .slice(0, 5)
      .flatMap((prediction) =>
        prediction.place_id && prediction.description
          ? [
              {
                placeId: prediction.place_id,
                description: prediction.description,
              },
            ]
          : [],
      );
  }

  private async request<T>(
    url: string,
    parameters: Record<string, string | undefined>,
  ): Promise<T | null> {
    if (!this.apiKey) return null;

    const requestUrl = `${url}?${new URLSearchParams(
      Object.entries(parameters).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )}`;

    for (let attempt = 0; attempt <= env.GOOGLE_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        env.GOOGLE_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await this.fetcher(requestUrl, {
          signal: controller.signal,
        });

        if (response.ok) {
          return (await response.json()) as T;
        }

        if (response.status < 500 && response.status !== 429) {
          return null;
        }

        if (attempt < env.GOOGLE_MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(50 * 2 ** attempt, 500)),
          );
        }
      } catch (error) {
        this.logger('google_maps_request_failed', {
          url,
          attempt,
          reason: error instanceof Error ? error.name : 'unknown',
        });

        if (attempt < env.GOOGLE_MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(50 * 2 ** attempt, 500)),
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    this.logger('google_maps_request_exhausted', {
      url,
      retries: env.GOOGLE_MAX_RETRIES,
    });

    return null;
  }
}