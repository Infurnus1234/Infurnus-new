import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/presentation/widgets/vehicle_presentation_catalog.dart';

FleetVehicleModel vehicle(
  String sector,
  String code, {
  String? name,
  bool active = true,
  bool visible = true,
}) => FleetVehicleModel(
  id: '$sector:$code',
  make: '',
  model: '',
  name: name ?? code,
  sector: sector,
  category: code,
  fuelRatePerKm: 0,
  loadCapacityKg: 0,
  active: active,
  catalogVisible: visible,
);

void main() {
  test(
    'an empty server catalog never falls back to bundled vehicle options',
    () {
      for (final sector in ['rental', 'logistics', 'premium', 'service']) {
        expect(customerVehiclePresentation(sector, []), isEmpty);
      }
    },
  );
  test('backend ordering and edited names win while existing codes and images are preserved', () {
    final items = customerVehiclePresentation('logistics', [
      vehicle('logistics', 'tata_407', name: 'Admin edited 407'),
      vehicle('logistics', 'cargo_207', name: 'Tata 207'),
    ]);
    expect(items.map((v) => v['category']), ['tata_407', 'cargo_207']);
    expect(items.map((v) => v['name']), ['Admin edited 407', 'Tata 207']);
    expect(items[0]['image'], 'assets/images/cargo_407.jpg');
    expect(items[1]['image'], 'assets/images/cargo_207_heavy.png');
  });
  test('published unpriced records remain visible while hidden, duplicate and wrong-sector records are excluded', () {
    for (final sector in ['rental', 'logistics', 'premium', 'service']) {
      final items = customerVehiclePresentation(sector, [
        vehicle(sector, 'active'),
        vehicle(sector, 'active'),
        vehicle(sector, 'inactive', active: false),
        vehicle(sector, 'hidden', visible: false),
        vehicle('wrong-sector', 'wrong'),
      ]);
      expect(items.map((v) => v['category']), ['active', 'inactive']);
    }
  });
  test('new Admin codes appear in every category without any application whitelist', () {
    for (final sector in ['rental', 'logistics', 'premium', 'service']) {
      final items = customerVehiclePresentation(sector, [
        vehicle(sector, 'new_admin_type', name: 'New Admin vehicle'),
      ]);
      expect(items.single['category'], 'new_admin_type');
      expect(items.single['name'], 'New Admin vehicle');
    }
  });
}
