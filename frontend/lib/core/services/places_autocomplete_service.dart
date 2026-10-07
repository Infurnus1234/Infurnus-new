import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/dio_client.dart';

String locationSearchErrorMessage(Object error) {
  if (error is FormatException || error is TypeError) {
    return 'Invalid location search response. Please retry.';
  }
  if (error is DioException) {
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Location search timed out. Please retry.';
    }
    if (error.type == DioExceptionType.connectionError) {
      return 'Cannot reach location search. Check your connection.';
    }
    final body = error.response?.data;
    final detail = body is Map ? body['error'] : null;
    final code = detail is Map ? detail['code'] : null;
    if (code == 'MAP_PROVIDER_AUTHORIZATION' ||
        code == 'MAP_PROVIDER_NOT_CONFIGURED') {
      return 'Location provider authorization/configuration problem.';
    }
    if (code == 'MAP_PROVIDER_INVALID') {
      return 'Location provider returned an invalid response.';
    }
    if (code == 'MAP_PROVIDER_TIMEOUT') {
      return 'Location provider timed out. Please retry.';
    }
    if (code == 'MAP_PROVIDER_NETWORK') {
      return 'Location provider connection failed. Please retry.';
    }
    if (code == 'MAP_PROVIDER_UNAVAILABLE') {
      return 'Location provider is unavailable. Please retry.';
    }
    if (error.response?.statusCode == 401 ||
        error.response?.statusCode == 403) {
      return 'Location search requires authentication. Please sign in again.';
    }
    if (error.response != null) {
      return 'Location search backend failed. Please retry.';
    }
    return 'Cannot reach location search. Check your connection.';
  }
  return 'Location search unavailable. Please retry.';
}

class PlaceSuggestion {
  final String id;
  final String title;
  final String subtitle;
  final double? latitude;
  final double? longitude;

  const PlaceSuggestion({
    required this.id,
    required this.title,
    required this.subtitle,
    this.latitude,
    this.longitude,
  });

  @override
  String toString() => subtitle.isEmpty ? title : '$title, $subtitle';
}

abstract class PlacesAutocompleteService {
  Future<List<PlaceSuggestion>> getSuggestions(
    String query, {
    CancelToken? cancelToken,
  });
  void clearCache();
}

// Retained compatibility API; the app continues to use backend Google search.
class OpenStreetMapAutocompleteService implements PlacesAutocompleteService {
  final Dio _dio;
  final Map<String, List<PlaceSuggestion>> _cache = {};
  static const int _maxCacheEntries = 100;
  static const int _minQueryLength = 2;

  OpenStreetMapAutocompleteService({Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 4),
              receiveTimeout: const Duration(seconds: 4),
              headers: {
                'User-Agent': 'InfurnusApp/1.0 (contact@infurnus.com)',
                'Accept': 'application/json',
              },
            ),
          );

  @override
  Future<List<PlaceSuggestion>> getSuggestions(
    String query, {
    CancelToken? cancelToken,
  }) async {
    final trimmed = query.trim();
    if (trimmed.length < _minQueryLength) {
      return [];
    }
    if (cancelToken?.isCancelled ?? false) return [];

    final normalizedKey = trimmed.toLowerCase();
    if (_cache.containsKey(normalizedKey)) {
      return _cache[normalizedKey]!;
    }

    try {
      final response = await _dio.get<List<dynamic>>(
        'https://nominatim.openstreetmap.org/search',
        queryParameters: {
          'q': '$trimmed, India',
          'format': 'json',
          'addressdetails': 1,
          'countrycodes': 'in',
          'limit': 6,
        },
        cancelToken: cancelToken,
      );

      if (response.statusCode == 200 && response.data != null) {
        final suggestions = <PlaceSuggestion>[];
        final seenIds = <String>{};

        for (final item in response.data!) {
          if (item is! Map<String, dynamic>) continue;
          final placeId = (item['place_id'] ?? '').toString();
          if (placeId.isEmpty || seenIds.contains(placeId)) continue;

          final displayName = (item['display_name'] ?? '').toString();
          final latitude = double.tryParse((item['lat'] ?? '').toString());
          final longitude = double.tryParse((item['lon'] ?? '').toString());
          if (displayName.isEmpty || latitude == null || longitude == null) {
            continue;
          }

          final parts = displayName.split(',');
          final title = parts.isNotEmpty ? parts.first.trim() : displayName;
          final subtitle = parts.length > 1
              ? parts.sublist(1).take(3).map((s) => s.trim()).join(', ')
              : displayName;

          suggestions.add(
            PlaceSuggestion(
              id: placeId,
              title: title,
              subtitle: subtitle,
              latitude: latitude,
              longitude: longitude,
            ),
          );
          seenIds.add(placeId);
        }

        if (_cache.length >= _maxCacheEntries) {
          _cache.remove(_cache.keys.first);
        }
        _cache[normalizedKey] = suggestions;
        return suggestions;
      }
    } on DioException catch (error) {
      if (CancelToken.isCancel(error)) return [];
    } catch (_) {
      return [];
    }

    return [];
  }

  @override
  void clearCache() {
    _cache.clear();
  }
}

class BackendPlacesAutocompleteService implements PlacesAutocompleteService {
  final Dio _dio;
  BackendPlacesAutocompleteService(this._dio);
  @override
  Future<List<PlaceSuggestion>> getSuggestions(
    String query, {
    CancelToken? cancelToken,
  }) async {
    if (query.trim().isEmpty) return [];
    final response = await _dio.get(
      '/maps/search',
      queryParameters: {'query': query.trim()},
      cancelToken: cancelToken,
    );
    final body = response.data;
    final data = body is Map ? body['data'] : null;
    if (data is! List) throw const FormatException('Invalid location response');
    if (data.any(
      (item) =>
          item is! Map ||
          item['placeId'] is! String ||
          (item['placeId'] as String).trim().isEmpty ||
          item['description'] is! String ||
          (item['description'] as String).trim().isEmpty,
    )) {
      throw const FormatException('Invalid location prediction');
    }
    return data
        .whereType<Map>()
        .map(
          (item) => PlaceSuggestion(
            id: item['placeId'] as String,
            title: item['description'] as String,
            subtitle: '',
          ),
        )
        .toList();
  }

  @override
  void clearCache() {} // The existing backend owns provider-aware caching.
}

final placesAutocompleteServiceProvider = Provider<PlacesAutocompleteService>((
  ref,
) {
  return BackendPlacesAutocompleteService(ref.read(dioProvider));
});
