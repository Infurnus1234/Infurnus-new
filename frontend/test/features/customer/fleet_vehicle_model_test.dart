import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';

void main() {
  group('FleetVehicleModel Serialization & Projection', () {
    test('should correctly deserialize active customer fleet vehicle JSON', () {
      final json = {
        'id': 'veh-cust-1',
        'make': 'Toyota',
        'model': 'Fortuner',
        'color': 'Pearl White',
        'sector': 'premium',
        'category': 'fortuner',
        'fuelRatePerKm': 16.0,
        'loadCapacityKg': 0,
      };

      final model = FleetVehicleModel.fromJson(json);

      expect(model.id, 'veh-cust-1');
      expect(model.make, 'Toyota');
      expect(model.model, 'Fortuner');
      expect(model.color, 'Pearl White');
      expect(model.sector, 'premium');
      expect(model.category, 'fortuner');
      expect(model.fuelRatePerKm, 16.0);
      expect(model.loadCapacityKg, 0);
    });

    test('should serialize to JSON correctly without leaking driver PII', () {
      final model = FleetVehicleModel(
        id: 'veh-cust-2',
        make: 'Tata',
        model: 'Ace',
        color: 'White',
        sector: 'logistics',
        category: 'mini_truck',
        fuelRatePerKm: 0.0,
        loadCapacityKg: 1000,
      );

      final json = model.toJson();

      expect(json['id'], 'veh-cust-2');
      expect(json['make'], 'Tata');
      expect(json['model'], 'Ace');
      expect(json['sector'], 'logistics');
      expect(json['category'], 'mini_truck');
      expect(json['loadCapacityKg'], 1000);
      expect(json.containsKey('driverProfileId'), isFalse);
      expect(json.containsKey('plateNumber'), isFalse);
    });

    test('should default missing numeric values safely', () {
      final json = {
        'id': 'veh-cust-3',
        'make': 'Bajaj',
        'model': 'Compact',
        'sector': 'passenger',
        'category': 'auto',
      };

      final model = FleetVehicleModel.fromJson(json);

      expect(model.fuelRatePerKm, 0.0);
      expect(model.loadCapacityKg, 0);
      expect(model.color, isNull);
    });
  });
}
