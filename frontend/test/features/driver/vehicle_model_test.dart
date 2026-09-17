import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/driver/data/models/vehicle_model.dart';

void main() {
  group('VehicleModel JSON serialization', () {
    test('should correctly deserialize valid vehicle JSON', () {
      final json = {
        'id': 'v-789',
        'driverProfileId': 'dp-101',
        'make': 'Toyota',
        'model': 'Camry',
        'color': 'White',
        'plateNumber': 'KA-01-AB-1234',
        'isActive': true,
        'retiredAt': null,
        'createdAt': '2023-01-01T10:00:00.000Z',
        'updatedAt': '2023-01-02T10:00:00.000Z',
      };

      final model = VehicleModel.fromJson(json);

      expect(model.id, 'v-789');
      expect(model.driverProfileId, 'dp-101');
      expect(model.make, 'Toyota');
      expect(model.model, 'Camry');
      expect(model.plateNumber, 'KA-01-AB-1234');
      expect(model.isActive, isTrue);
    });
  });
}
