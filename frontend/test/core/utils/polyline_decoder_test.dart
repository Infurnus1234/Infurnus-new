import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/utils/polyline_decoder.dart';

void main() {
  group('PolylineDecoder', () {
    test('should return empty list for empty string', () {
      expect(PolylineDecoder.decode(''), isEmpty);
    });

    test('should decode (0,0) correctly', () {
      final points = PolylineDecoder.decode('??');
      expect(points.length, 1);
      expect(points[0].latitude, 0.0);
      expect(points[0].longitude, 0.0);
    });

    test('should decode a single point correctly', () {
      // _p~iG~psuP -> (43.74288, -92.83872)
      final points = PolylineDecoder.decode('_p~iG~psuP');
      expect(points.length, 1);
      expect(points[0].latitude, closeTo(43.74288, 0.00001));
      expect(points[0].longitude, closeTo(-92.83872, 0.00001));
    });

    test('should decode multiple points correctly', () {
      // _p~iG~psuP_@vL_@_P
      final points = PolylineDecoder.decode('_p~iG~psuP_@vL_@_P');
      expect(points.length, 3);
      
      expect(points[0].latitude, closeTo(43.74288, 0.00001));
      expect(points[0].longitude, closeTo(-92.83872, 0.00001));
      
      expect(points[1].latitude, closeTo(43.74304, 0.00001));
      expect(points[1].longitude, closeTo(-92.84092, 0.00001));

      expect(points[2].latitude, closeTo(43.7432, 0.00001));
      expect(points[2].longitude, closeTo(-92.8382, 0.00001));
    });

    test('should handle negative coordinates correctly', () {
      // ~v_mExnmhU -> (-33.75488, -116.89213)
      final points = PolylineDecoder.decode('~v_mExnmhU');
      expect(points.length, 1);
      expect(points[0].latitude, closeTo(-33.75488, 0.00001));
      expect(points[0].longitude, closeTo(-116.89213, 0.00001));
    });
  });
}
