import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/domain/utils/vehicle_category_mapper.dart';

void main() {
  test(
    'different vehicle categories never borrow another category identity',
    () {
      for (final sector in [
        'passenger',
        'logistics',
        'service',
        'premium',
        'rental',
      ]) {
        for (final code in [
          'sedan',
          'suv',
          'hatchback',
          'innova',
          'winger',
          'traveller',
          'piaggio_ape',
          'tata_magic',
          'cargo_207',
          'cargo_407',
          'crane',
          'scorpio',
          'unknown_vehicle',
          '',
        ]) {
          expect(normalizeVehicleCategoryForBackend(sector, code), code);
        }
      }
      expect(
        normalizeVehicleCategoryForBackend('passenger', 'Innova Crysta'),
        'innova',
      );
      expect(
        normalizeVehicleCategoryForBackend('passenger', 'Force Traveller'),
        'traveller',
      );
    },
  );
}
