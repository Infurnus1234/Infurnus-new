import 'dart:convert';
import 'dart:io';

import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';

import 'vehicle_fare_ranges_test.dart' show RecordingRepository;

/// The synthetic server publishes the approved initial catalog for UI tests.
/// Production presentation always consumes the API response instead of this file.
class ConfiguredCatalogRepository extends RecordingRepository {
  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async {
    final fixtures = jsonDecode(
      File('test/fixtures/original_vehicle_catalog.json').readAsStringSync(),
    ) as List;
    final inventorySector = sector == 'passenger' ? 'rental' : sector;
    final fixture = fixtures
        .cast<Map>()
        .where((item) => item['sector'] == inventorySector)
        .firstOrNull;
    return (fixture?['vehicles'] as List? ?? [])
        .cast<Map>()
        .where((item) => category == null || item['code'] == category)
        .map(
          (item) => FleetVehicleModel(
            id: '${inventorySector}_${item['code']}',
            make: '',
            model: '',
            name: item['name'] as String,
            sector: sector ?? 'rental',
            category: item['code'] as String,
            fuelRatePerKm: 0,
            loadCapacityKg: item['loadCapacityKg'] as int? ?? 0,
          ),
        )
        .toList();
  }
}
