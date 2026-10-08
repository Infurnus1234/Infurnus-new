import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/geocoding_service.dart';
import 'package:infurnus/core/services/places_autocomplete_service.dart';

void main() {
  test('one and two character queries reach the backend unchanged', () async {
    final dio = Dio();
    final sent = <String>[];
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) {
          sent.add(o.queryParameters['query'] as String);
          h.resolve(Response(requestOptions: o, data: {'data': <dynamic>[]}));
        },
      ),
    );
    final service = BackendPlacesAutocompleteService(dio);
    for (final query in ['P', 'PA', 'PAT', 'M', 'MU', 'MUJ']) {
      await service.getSuggestions(query);
    }
    await service.getSuggestions('  ');
    expect(sent, ['P', 'PA', 'PAT', 'M', 'MU', 'MUJ']);
  });
  test('diagnostic messages distinguish search failure categories', () {
    final options = RequestOptions(path: '/maps/search');
    String message(String code, [int status = 503]) =>
        locationSearchErrorMessage(
          DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response(
              requestOptions: options,
              statusCode: status,
              data: {
                'error': {'code': code},
              },
            ),
          ),
        );
    expect(message('MAP_PROVIDER_AUTHORIZATION'), contains('authorization'));
    expect(message('MAP_PROVIDER_INVALID'), contains('invalid response'));
    expect(message('MAP_PROVIDER_TIMEOUT'), contains('timed out'));
    expect(message('MAP_PROVIDER_NETWORK'), contains('connection failed'));
    expect(
      message('MAP_PROVIDER_UNAVAILABLE'),
      contains('provider is unavailable'),
    );
    expect(message('INTERNAL_SERVER_ERROR', 500), contains('backend failed'));
    expect(message('INVALID_ACCESS_TOKEN', 401), contains('authentication'));
    expect(
      locationSearchErrorMessage(const FormatException()),
      contains('Invalid'),
    );
    expect(
      locationSearchErrorMessage(
        DioException(
          requestOptions: options,
          type: DioExceptionType.connectionError,
        ),
      ),
      contains('connection'),
    );
    expect(
      locationSearchErrorMessage(
        DioException(
          requestOptions: options,
          type: DioExceptionType.receiveTimeout,
        ),
      ),
      contains('timed out'),
    );
  });
  test('a malformed prediction cannot silently become zero results', () async {
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) => h.resolve(
          Response(
            requestOptions: o,
            data: {
              'data': ['invalid prediction'],
            },
          ),
        ),
      ),
    );
    await expectLater(
      BackendPlacesAutocompleteService(dio).getSuggestions('PAT'),
      throwsA(isA<FormatException>()),
    );
  });
  test('genuine empty provider predictions remain an empty success', () async {
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) =>
            h.resolve(Response(requestOptions: o, data: {'data': []})),
      ),
    );
    expect(
      await BackendPlacesAutocompleteService(dio).getSuggestions('PAT'),
      isEmpty,
    );
  });
  for (final query in [
    'PAT',
    'Pat',
    'GAY',
    'MUF',
    'DAR',
    'BHA',
    'Patna Junction',
  ]) {
    test(
      'partial query $query reaches the existing backend search unchanged',
      () async {
        final dio = Dio();
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              expect(options.path, '/maps/search');
              expect(options.queryParameters, {'query': query});
              handler.resolve(
                Response(
                  requestOptions: options,
                  data: {
                    'data': [
                      {
                        'placeId': 'provider-result',
                        'description': 'Provider returned address',
                      },
                    ],
                  },
                ),
              );
            },
          ),
        );
        final results = await BackendPlacesAutocompleteService(dio)
            .getSuggestions(query);
        expect(results.single.title, 'Provider returned address');
        expect(results.single.toString(), 'Provider returned address');
        expect(results.single.latitude, isNull);
      },
    );
  }
  test(
    'search provider failure is not converted to a false empty result',
    () async {
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (o, h) => h.reject(DioException(requestOptions: o)),
        ),
      );
      await expectLater(
        BackendPlacesAutocompleteService(dio).getSuggestions('Pat'),
        throwsA(isA<DioException>()),
      );
    },
  );
  test(
    'selected address resolves via backend without a fallback coordinate',
    () async {
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (o, h) {
            expect(o.path, '/maps/geocode');
            expect(o.data, {'address': 'Provider supplied full address'});
            h.resolve(
              Response(
                requestOptions: o,
                data: {
                  'data': {'latitude': 24.7955, 'longitude': 85.0002},
                },
              ),
            );
          },
        ),
      );
      final point = await GeocodingService(dio: dio)
          .geocodeAddress('Provider supplied full address');
      expect(point!.latitude, 24.7955);
      expect(point.longitude, 85.0002);
    },
  );
  test(
    'invalid returned coordinates are rejected before SDK clamping',
    () async {
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (o, h) => h.resolve(
            Response(
              requestOptions: o,
              data: {
                'data': {'latitude': 999, 'longitude': 85},
              },
            ),
          ),
        ),
      );
      expect(
        await GeocodingService(dio: dio)
            .geocodeAddress('Invalid provider result'),
        isNull,
      );
    },
  );
}
