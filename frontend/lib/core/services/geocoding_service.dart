import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../network/dio_client.dart';

class GeocodingService {
  final Dio _dio;
  GeocodingService({Dio? dio}) : _dio = dio ?? Dio();

  static bool validCoordinates(double lat, double lng) =>
      lat.isFinite &&
      lng.isFinite &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;

  Future<LatLng?> geocodeAddress(String query) async {
    final address = query.trim();
    if (address.isEmpty) return null;
    final match = RegExp(r'^([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$')
        .firstMatch(address);
    if (match != null) {
      final lat = double.parse(match.group(1)!);
      final lng = double.parse(match.group(2)!);
      return validCoordinates(lat, lng) ? LatLng(lat, lng) : null;
    }
    final response = await _dio.post(
      '/maps/geocode',
      data: {'address': address},
    );
    final point = response.data['data'];
    final lat = point?['latitude'], lng = point?['longitude'];
    if (lat is! num ||
        lng is! num ||
        !validCoordinates(lat.toDouble(), lng.toDouble())) {
      return null;
    }
    return LatLng(lat.toDouble(), lng.toDouble());
  }

  Future<String?> reverseGeocode(LatLng coordinates) async {
    if (!validCoordinates(coordinates.latitude, coordinates.longitude)) {
      return null;
    }
    final response = await _dio.post(
      '/maps/reverse-geocode',
      data: {
        'latitude': coordinates.latitude,
        'longitude': coordinates.longitude,
      },
    );
    final address = response.data['data']?['address'];
    return address is String && address.trim().isNotEmpty
        ? address.trim()
        : null;
  }
}

final geocodingServiceProvider = Provider<GeocodingService>((ref) {
  return GeocodingService(dio: ref.read(dioProvider));
});
