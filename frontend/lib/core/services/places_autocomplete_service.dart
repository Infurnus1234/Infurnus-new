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
  static const int _minQueryLength = 1;

  static const List<PlaceSuggestion> _popularLocations = [
    PlaceSuggestion(
      id: 'patna_jn',
      title: 'Patna Junction Railway Station',
      subtitle: 'Station Road, Fraser Road Area, Patna, Bihar',
      latitude: 25.6022,
      longitude: 85.1376,
    ),
    PlaceSuggestion(
      id: 'patna_airport',
      title: 'Jay Prakash Narayan Airport (Patna Airport)',
      subtitle: 'Shaheed Pir Ali Khan Marg, Patna, Bihar',
      latitude: 25.5913,
      longitude: 85.0880,
    ),
    PlaceSuggestion(
      id: 'gandhi_maidan',
      title: 'Gandhi Maidan',
      subtitle: 'Near Exhibition Road, Patna, Bihar',
      latitude: 25.6154,
      longitude: 85.1437,
    ),
    PlaceSuggestion(
      id: 'boring_road',
      title: 'Boring Road Chauraha',
      subtitle: 'Sri Krishnapuri, Patna, Bihar',
      latitude: 25.6127,
      longitude: 85.1189,
    ),
    PlaceSuggestion(
      id: 'kankarbagh',
      title: 'Kankarbagh Tempo Stand',
      subtitle: 'Kankarbagh Main Road, Patna, Bihar',
      latitude: 25.5960,
      longitude: 85.1550,
    ),
    PlaceSuggestion(
      id: 'danapur_stn',
      title: 'Danapur Railway Station',
      subtitle: 'Khagaul, Patna, Bihar',
      latitude: 25.5786,
      longitude: 85.0441,
    ),
    PlaceSuggestion(
      id: 'aiims_patna',
      title: 'AIIMS Patna',
      subtitle: 'Phulwari Sharif, Patna, Bihar',
      latitude: 25.5606,
      longitude: 85.0436,
    ),
    PlaceSuggestion(
      id: 'ecoworld_blr',
      title: 'RMZ Ecoworld Tech Park',
      subtitle: 'Outer Ring Road, Bellandur, Bengaluru',
      latitude: 12.9279,
      longitude: 77.6841,
    ),
    PlaceSuggestion(
      id: 'blr_airport',
      title: 'Kempegowda International Airport',
      subtitle: 'Devanahalli, Bengaluru, Karnataka',
      latitude: 13.1986,
      longitude: 77.7066,
    ),
  ];

  OpenStreetMapAutocompleteService({Dio? dio})
      : _dio = dio ??
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
  Future<List<PlaceSuggestion>> getSuggestions(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < _minQueryLength) {
      return [];
    }

    final normalizedKey = trimmed.toLowerCase();
    if (_cache.containsKey(normalizedKey)) {
      return _cache[normalizedKey]!;
    }

    final localMatches = _popularLocations.where((place) {
      final t = place.title.toLowerCase();
      final s = place.subtitle.toLowerCase();
      return t.contains(normalizedKey) || s.contains(normalizedKey);
    }).toList();

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
      );

      if (response.statusCode == 200 && response.data != null) {
        final suggestions = <PlaceSuggestion>[...localMatches];
        final seenIds = suggestions.map((s) => s.id).toSet();

        for (final item in response.data!) {
          if (item is! Map<String, dynamic>) continue;
          final placeId = (item['place_id'] ?? '').toString();
          if (seenIds.contains(placeId)) continue;

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
          seenIds.add(placeId);
        }

        if (_cache.length >= _maxCacheEntries) {
          _cache.remove(_cache.keys.first);
        }
        _cache[normalizedKey] = suggestions;
        return suggestions;
      }
    } catch (_) {
      // Return local matching locations on network timeout
      return localMatches;
    }

    return localMatches;
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
