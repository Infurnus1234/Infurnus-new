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
  Future<List<PlaceSuggestion>> getSuggestions(String query);
  void clearCache();
}

class OpenStreetMapAutocompleteService implements PlacesAutocompleteService {
  final Dio _dio;
  final Map<String, List<PlaceSuggestion>> _cache = {};
  static const int _maxCacheEntries = 100;
  static const int _minQueryLength = 3;

  OpenStreetMapAutocompleteService({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 5),
                receiveTimeout: const Duration(seconds: 5),
                headers: {
                  'User-Agent': 'Infurnus-RideBooking/1.0',
                  'Accept': 'application/json',
                },
              ),
            );

  @override
  Future<List<PlaceSuggestion>> getSuggestions(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < _minQueryLength) {
      return [];
    }

    final normalizedKey = trimmed.toLowerCase();
    if (_cache.containsKey(normalizedKey)) {
      return _cache[normalizedKey]!;
    }

    try {
      final response = await _dio.get<List<dynamic>>(
        'https://nominatim.openstreetmap.org/search',
        queryParameters: {
          'q': trimmed,
          'format': 'json',
          'addressdetails': 1,
          'limit': 5,
        },
      );

      if (response.statusCode == 200 && response.data != null) {
        final suggestions = <PlaceSuggestion>[];
        for (final item in response.data!) {
          if (item is! Map<String, dynamic>) continue;
          final placeId = (item['place_id'] ?? '').toString();
          final displayName = (item['display_name'] ?? '') as String;
          final latStr = item['lat'] as String?;
          final lonStr = item['lon'] as String?;

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
              latitude: latStr != null ? double.tryParse(latStr) : null,
              longitude: lonStr != null ? double.tryParse(lonStr) : null,
            ),
          );
        }

        if (_cache.length >= _maxCacheEntries) {
          _cache.remove(_cache.keys.first);
        }
        _cache[normalizedKey] = suggestions;
        return suggestions;
      }
    } catch (_) {
      // In case of network errors or rate limit, fail gracefully
      return [];
    }

    return [];
  }

  @override
  void clearCache() {
    _cache.clear();
  }
}

final placesAutocompleteServiceProvider =
    Provider<PlacesAutocompleteService>((ref) {
  return OpenStreetMapAutocompleteService();
});
