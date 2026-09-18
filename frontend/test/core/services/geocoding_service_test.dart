import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/geocoding_service.dart';

void main() {
  group('GeocodingService', () {
    late GeocodingService geocodingService;

    setUp(() {
      geocodingService = GeocodingService();
    });

    test('parses direct comma-separated coordinate strings correctly', () async {
      final coords = await geocodingService.geocodeAddress('12.9716, 77.5946');
      expect(coords, isNotNull);
      expect(coords!.latitude, closeTo(12.9716, 0.0001));
      expect(coords.longitude, closeTo(77.5946, 0.0001));
    });

    test('parses negative and spaced coordinate strings', () async {
      final coords = await geocodingService.geocodeAddress(' -33.8688 , 151.2093 ');
      expect(coords, isNotNull);
      expect(coords!.latitude, closeTo(-33.8688, 0.0001));
      expect(coords.longitude, closeTo(151.2093, 0.0001));
    });

    test('returns null for empty string or whitespace without fallback', () async {
      final emptyCoords = await geocodingService.geocodeAddress('');
      final spaceCoords = await geocodingService.geocodeAddress('   ');
      expect(emptyCoords, isNull);
      expect(spaceCoords, isNull);
    });

    test('returns null for invalid out-of-range coordinates without fallback', () async {
      final invalidLat = await geocodingService.geocodeAddress('999.0, 77.0');
      expect(invalidLat, isNull);
    });
  });
}
