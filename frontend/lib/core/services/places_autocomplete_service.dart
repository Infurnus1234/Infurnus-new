import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
  String toString() => '$title, $subtitle';
}

abstract class PlacesAutocompleteService {
  Future<List<PlaceSuggestion>> getSuggestions(
    String query, {
    CancelToken? cancelToken,
  });
  void clearCache();
}

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
          if (displayName.isEmpty || latitude == null || longitude == null)
            continue;

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

final placesAutocompleteServiceProvider = Provider<PlacesAutocompleteService>((
  ref,
) {
  return OpenStreetMapAutocompleteService();
});
