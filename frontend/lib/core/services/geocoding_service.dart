import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class GeocodingService {
  final Dio _dio;

  GeocodingService({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 6),
                receiveTimeout: const Duration(seconds: 6),
                headers: {
                  'User-Agent': 'Infurnus-RideBooking/1.0',
                  'Accept': 'application/json',
                },
              ),
            );

  /// Geocodes an address string to LatLng coordinates.
  /// First checks if input is already formatted as "lat, lng" coordinates.
  /// Otherwise queries the OpenStreetMap Nominatim geocoding service.
  Future<LatLng?> geocodeAddress(String query) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return null;

    // 1. Direct coordinate format parse: "12.9716, 77.5946" or "12.9716,77.5946"
    final coordMatch = RegExp(
      r'^([-+]?\d{1,2}(?:\.\d+)?)\s*,\s*([-+]?\d{1,3}(?:\.\d+)?)$',
    ).firstMatch(trimmed);

    if (coordMatch != null) {
      final lat = double.tryParse(coordMatch.group(1)!);
      final lng = double.tryParse(coordMatch.group(2)!);
      if (lat != null &&
          lng != null &&
          lat >= -90.0 &&
          lat <= 90.0 &&
          lng >= -180.0 &&
          lng <= 180.0) {
        return LatLng(lat, lng);
      }
    }

    // 2. Geocoding via Nominatim
    try {
      final response = await _dio.get<List<dynamic>>(
        'https://nominatim.openstreetmap.org/search',
        queryParameters: {
          'q': trimmed,
          'format': 'json',
          'limit': 1,
        },
      );

      if (response.statusCode == 200 &&
          response.data != null &&
          response.data!.isNotEmpty) {
        final first = response.data!.first as Map<String, dynamic>;
        final latStr = first['lat'] as String?;
        final lonStr = first['lon'] as String?;
        if (latStr != null && lonStr != null) {
          final lat = double.tryParse(latStr);
          final lng = double.tryParse(lonStr);
          if (lat != null && lng != null) {
            return LatLng(lat, lng);
          }
        }
      }
    } catch (_) {
      return null;
    }

    return null;
  }
}

final geocodingServiceProvider = Provider<GeocodingService>((ref) {
  return GeocodingService();
});
