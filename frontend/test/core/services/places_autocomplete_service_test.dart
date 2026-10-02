import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/places_autocomplete_service.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';

void main() {
  group('PlacesAutocompleteService Tests', () {
    late OpenStreetMapAutocompleteService service;

    setUp(() {
      service = OpenStreetMapAutocompleteService();
    });

    test('returns empty suggestions for empty or whitespace queries without API call', () async {
      final results1 = await service.getSuggestions('');
      final results2 = await service.getSuggestions('   ');

      expect(results1, isEmpty);
      expect(results2, isEmpty);
    });

    test('caches suggestions and respects clearCache', () async {
      service.clearCache();
      expect(await service.getSuggestions('  '), isEmpty);
    });

    test(
      'returns live suggestions with both coordinates from the provider',
      () async {
        final dio = Dio();
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: [
                    {
                      'place_id': 42,
                      'display_name': 'Central Station, City, State',
                      'lat': '12.34',
                      'lon': '56.78',
                    },
                    {
                      'place_id': 43,
                      'display_name': 'Missing Coordinates, City',
                    },
                  ],
                ),
              );
            },
          ),
        );
        final liveService = OpenStreetMapAutocompleteService(dio: dio);

        final results = await liveService.getSuggestions('Central Station');

        expect(results, hasLength(1));
        expect(results.single.title, 'Central Station');
        expect(results.single.latitude, 12.34);
        expect(results.single.longitude, 56.78);
      },
    );
  });

  group('FleetVehicleModel Dynamic Fields Tests', () {
    test('deserializes minimal fleet vehicle without optional fields', () {
      final json = {
        'id': 'v-101',
        'make': 'Toyota',
        'model': 'Innova',
        'sector': 'passenger',
        'category': 'suv',
        'fuelRatePerKm': 15.0,
        'loadCapacityKg': 500,
      };

      final vehicle = FleetVehicleModel.fromJson(json);

      expect(vehicle.id, 'v-101');
      expect(vehicle.displayName, 'Toyota Innova');
      expect(vehicle.fuelRatePerKm, 15.0);
      expect(vehicle.effectivePerKmCost, 15.0);
      expect(vehicle.fuelType, isNull);
      expect(vehicle.range, isNull);
    });

    test('deserializes full dynamic fleet vehicle with prices, range, fuel, and attributes', () {
      final json = {
        'id': 'v-202',
        'name': 'Tata Nexon EV Max',
        'make': 'Tata',
        'model': 'Nexon EV',
        'sector': 'passenger',
        'category': 'compact_suv',
        'fuelRatePerKm': 4.5,
        'loadCapacityKg': 400,
        'imageUrl': 'https://infurnus.com/assets/nexon_ev.png',
        'fuelType': 'Electric',
        'mileage': '14.2 kWh/100km',
        'range': '437 km',
        'pricing': 1200.0,
        'perKmCost': 5.0,
        'attributes': {'batteryCapacityKwh': 40.5, 'fastCharging': true},
      };

      final vehicle = FleetVehicleModel.fromJson(json);

      expect(vehicle.id, 'v-202');
      expect(vehicle.displayName, 'Tata Nexon EV Max');
      expect(vehicle.fuelType, 'Electric');
      expect(vehicle.range, '437 km');
      expect(vehicle.pricing, 1200.0);
      expect(vehicle.effectivePerKmCost, 5.0);
      expect(vehicle.attributes?['fastCharging'], true);

      final serialized = vehicle.toJson();
      expect(serialized['name'], 'Tata Nexon EV Max');
      expect(serialized['range'], '437 km');
      expect(serialized['pricing'], 1200.0);
    });
  });
}
