import { decodePolyline, validateCoordinates } from '../../maps/geometry.js';

import { AppError } from '../../../common/errors/app-error.js';

import { env } from '../../../config/env.js';

import type {
  Coordinates,
  MapRequestOptions,
  ReverseGeocodeResult,
  MapProvider,
  MatrixRouteResult,
  PlaceSuggestion,
  RouteResult,
} from './map.provider.js';

interface GoogleResponse {
  status?: string;
  error_message?: string;

  routes?: Array<{
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
    }>;
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
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;

  predictions?: Array<{
    place_id?: string;
    description?: string;
  }>;
}

export class GoogleMapsProvider implements MapProvider {
  readonly providerName = 'google';

  private readonly apiKey: string | undefined;

  constructor(
    apiKey?: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly logger: (event: string, metadata: Record<string, unknown>) => void = () => {},
  ) {
    // Omission uses server configuration; explicit undefined disables requests.
    this.apiKey = arguments.length === 0 ? env.GOOGLE_MAPS_API_KEY : apiKey;
  }

  async calculateRoute(
    origin: Coordinates,
    destination: Coordinates,
    options: MapRequestOptions = {},
  ): Promise<RouteResult | null> {
    validateCoordinates(origin);
    validateCoordinates(destination);

    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/directions/json',
      {
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        mode: options.mode ?? 'driving',
        avoid: options.avoidTolls ? 'tolls' : undefined,
        key: this.apiKey,
      },
      options,
    );

    if (response?.status === 'ZERO_RESULTS') return null;

    const leg = response?.routes?.[0]?.legs?.[0];

    if (
      typeof leg?.distance?.value !== 'number' ||
      !Number.isFinite(leg.distance.value) ||
      leg.distance.value < 0 ||
      typeof leg.duration?.value !== 'number' ||
      !Number.isFinite(leg.duration.value) ||
      leg.duration.value < 0
    ) {
      return null;
    }

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
    options: MapRequestOptions = {},
  ): Promise<MatrixRouteResult[]> {
    const boundedOrigins = origins.slice(0, env.MAX_DRIVER_MATCH_CANDIDATES);

    if (boundedOrigins.length === 0) return [];

    boundedOrigins.forEach(validateCoordinates);
    validateCoordinates(destination);

    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        origins: boundedOrigins.map((point) => `${point.latitude},${point.longitude}`).join('|'),
        destinations: `${destination.latitude},${destination.longitude}`,
        key: this.apiKey,
      },
      options,
    );

    if (response?.status === 'ZERO_RESULTS') {
      return boundedOrigins.map((origin) => ({
        origin,
        route: null,
      }));
    }

    return boundedOrigins.map((origin, index) => {
      const element = response?.rows?.[index]?.elements?.[0];

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

  async geocode(address: string, options: MapRequestOptions = {}): Promise<Coordinates | null> {
    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/geocode/json',
      {
        address,
        components: `country:${env.MAP_COUNTRY}|administrative_area:${env.MAP_REGION}`,
        key: this.apiKey,
      },
      options,
    );

    if (response?.status === 'ZERO_RESULTS') return null;

    const location = response?.results?.[0]?.geometry?.location;

    if (typeof location?.lat !== 'number' || typeof location.lng !== 'number') {
      return null;
    }

    return {
      latitude: location.lat,
      longitude: location.lng,
    };
  }

  async places(query: string, options: MapRequestOptions = {}): Promise<PlaceSuggestion[]> {
    if (query.trim().length < env.GOOGLE_PLACES_MIN_QUERY_LENGTH) {
      return [];
    }

    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json',
      {
        input: query.trim(),
        location: options.locationBias
          ? `${options.locationBias.latitude},${options.locationBias.longitude}`
          : undefined,
        radius: options.locationBias ? '50000' : undefined,
        components: `country:${env.MAP_COUNTRY}`,
        language: 'en',
        key: this.apiKey,
      },
      options,
    );

    if (response?.status === 'ZERO_RESULTS') return [];

    return (response?.predictions ?? []).slice(0, 5).flatMap((prediction) =>
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

  async reverseGeocode(
    point: Coordinates,
    options: MapRequestOptions = {},
  ): Promise<ReverseGeocodeResult | null> {
    const response = await this.request<GoogleResponse>(
      'https://maps.googleapis.com/maps/api/geocode/json',
      {
        latlng: `${point.latitude},${point.longitude}`,
        key: this.apiKey,
      },
      options,
    );

    if (response?.status === 'ZERO_RESULTS') return null;

    const result = response?.results?.[0];

    if (!result?.formatted_address) return null;

    return {
      address: result.formatted_address,
      coordinates: point,
      ...(result.place_id ? { placeId: result.place_id } : {}),
    };
  }

  private validateResponse(
    body: GoogleResponse,
    url: string,
    parameters: Record<string, string | undefined>,
  ) {
    const invalid = () =>
      new AppError('MAP_PROVIDER_INVALID', 'Map provider returned invalid data', 503);

    const amount = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0;

    if (body.status === 'ZERO_RESULTS') return;

    if (body.status !== undefined && body.status !== 'OK') {
      throw invalid();
    }

    if (url.includes('directions')) {
      if (!body.routes?.length) throw invalid();

      for (const route of body.routes) {
        if (
          !route?.legs?.length ||
          !route.legs.every(
            (leg) => leg && amount(leg.distance?.value) && amount(leg.duration?.value),
          )
        ) {
          throw invalid();
        }

        const line = route.overview_polyline?.points;

        if (
          route.overview_polyline !== undefined &&
          (typeof line !== 'string' || decodePolyline(line).length < 2)
        ) {
          throw invalid();
        }
      }
    } else if (url.includes('distancematrix')) {
      if (body.rows?.length !== parameters.origins?.split('|').length) {
        throw invalid();
      }

      for (const row of body.rows!) {
        const element = row?.elements?.[0];

        if (row?.elements?.length !== 1 || !element) {
          throw invalid();
        }

        if (element.status === 'ZERO_RESULTS' || element.status === 'NOT_FOUND') {
          continue;
        }

        if (element.status !== 'OK') {
          throw new AppError(
            'MAP_PROVIDER_UNAVAILABLE',
            'Map provider rejected a matrix element',
            503,
          );
        }

        if (!amount(element.distance?.value) || !amount(element.duration?.value)) {
          throw invalid();
        }
      }
    } else if (url.includes('autocomplete')) {
      if (
        !body.predictions?.every(
          (p) =>
            p &&
            typeof p.place_id === 'string' &&
            p.place_id.length > 0 &&
            typeof p.description === 'string' &&
            p.description.length > 0,
        )
      ) {
        throw invalid();
      }
    } else {
      if (!body.results?.length) throw invalid();

      for (const result of body.results) {
        const location = result?.geometry?.location;

        try {
          validateCoordinates({
            latitude: location?.lat as number,
            longitude: location?.lng as number,
          });
        } catch {
          throw invalid();
        }

        if (
          parameters.latlng &&
          (typeof result.formatted_address !== 'string' || !result.formatted_address.trim())
        ) {
          throw invalid();
        }
      }
    }
  }

  private async request<T>(
    url: string,
    parameters: Record<string, string | undefined>,
    options: MapRequestOptions = {},
  ): Promise<T | null> {
    if (!this.apiKey?.trim()) {
      throw new AppError(
        'MAP_PROVIDER_NOT_CONFIGURED',
        'Map provider credentials are not configured',
        503,
      );
    }

    const requestUrl = `${url}?${new URLSearchParams(
      Object.entries(parameters).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )}`;

    let failureCode = 'MAP_PROVIDER_UNAVAILABLE';

    for (let attempt = 0; attempt <= env.GOOGLE_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();

      let timeout: ReturnType<typeof setTimeout> | undefined;

      let started = this.now();
      let success = false;
      let attempted = false;

      try {
        await options.beforeExternalRequest?.();

        started = this.now();

        timeout = setTimeout(() => controller.abort(), env.GOOGLE_REQUEST_TIMEOUT_MS);

        attempted = true;

        options.onExternalRequest?.();

        const response = await this.fetcher(requestUrl, {
          signal: controller.signal,
        });

        if (response.ok) {
          const body = (await response.json()) as T;

          // Safe Google Maps diagnostic logging.
          // API key is intentionally never logged.
          const googleBody = body as GoogleResponse;

          if (googleBody?.status && googleBody.status !== 'OK') {
            this.logger('google_maps_provider_response', {
              status: googleBody.status,
              errorMessage: googleBody.error_message ?? null,
              apiType: url.includes('directions')
                ? 'route'
                : url.includes('distancematrix')
                  ? 'matrix'
                  : url.includes('autocomplete')
                    ? 'search'
                    : parameters.latlng
                      ? 'reverse'
                      : 'geocode',
            });
          }

          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new AppError('MAP_PROVIDER_INVALID', 'Map provider returned invalid data', 503);
          }

          const status = (body as { status?: string }).status;

          const collection = url.includes('directions')
            ? 'routes'
            : url.includes('distancematrix')
              ? 'rows'
              : url.includes('autocomplete')
                ? 'predictions'
                : 'results';

          if (
            (!status || status === 'OK') &&
            !Array.isArray((body as Record<string, unknown>)[collection])
          ) {
            throw new AppError('MAP_PROVIDER_INVALID', 'Map provider returned invalid data', 503);
          }

          const allowed = !status || status === 'OK' || status === 'ZERO_RESULTS';

          if (status === 'REQUEST_DENIED') {
            throw new AppError(
              'MAP_PROVIDER_AUTHORIZATION',
              'Map provider authorization failed (REQUEST_DENIED)',
              503,
            );
          }

          if (!allowed) {
            throw new AppError(
              'MAP_PROVIDER_UNAVAILABLE',
              'Map provider rejected the request',
              503,
            );
          }

          this.validateResponse(body as GoogleResponse, url, parameters);

          success = true;

          return body;
        }

        if (response.status === 401 || response.status === 403) {
          throw new AppError(
            'MAP_PROVIDER_AUTHORIZATION',
            'Map provider authorization failed',
            503,
          );
        }

        if (response.status < 500 && response.status !== 429) {
          throw new AppError('MAP_PROVIDER_UNAVAILABLE', 'Map provider rejected the request', 503);
        }

        if (attempt < env.GOOGLE_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(50 * 2 ** attempt, 500)));
        }
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        failureCode = controller.signal.aborted ? 'MAP_PROVIDER_TIMEOUT' : 'MAP_PROVIDER_NETWORK';

        this.logger('google_maps_request_failed', {
          attempt,
          reason: error instanceof Error ? error.name : 'unknown',
        });

        if (attempt < env.GOOGLE_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(50 * 2 ** attempt, 500)));
        }
      } finally {
        clearTimeout(timeout);

        if (attempted) {
          this.logger('map_provider_request', {
            provider: 'google',
            apiType: url.includes('directions')
              ? 'route'
              : url.includes('distancematrix')
                ? 'matrix'
                : url.includes('autocomplete')
                  ? 'search'
                  : parameters.latlng
                    ? 'reverse'
                    : 'geocode',
            module: options.source ?? 'RIDE',
            requestType: 'http',
            timestamp: new Date().toISOString(),
            cache: 'miss',
            success,
            responseTimeMs: this.now() - started,
            attempt,
          });
        }
      }
    }

    this.logger('google_maps_request_exhausted', {
      retries: env.GOOGLE_MAX_RETRIES,
    });

    throw new AppError(
      failureCode,
      failureCode === 'MAP_PROVIDER_TIMEOUT'
        ? 'Map provider request timed out'
        : 'Map provider is temporarily unavailable',
      503,
    );
  }
}
