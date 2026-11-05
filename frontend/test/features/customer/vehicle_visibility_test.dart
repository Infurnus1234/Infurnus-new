import 'package:infurnus/features/customer/domain/utils/passenger_catalog.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/domain/utils/vehicle_visibility.dart';
import 'package:infurnus/features/customer/presentation/widgets/vehicle_presentation_catalog.dart';

void main() {
  test('Passenger catalog shows exactly four vehicles with existing codes', () {
    expect(
      customerVehiclePresentation(
        'passenger',
        [],
      ).map((v) => (v['name'], v['category'])),
      [
        ('Hatchback', 'hatchback'),
        ('Sedan', 'sedan'),
        ('Innova Crysta', 'innova'),
        ('Minicab', 'mini'),
      ],
    );
    for (final code in [
      'suv',
      'winger',
      'traveller',
      'mini_commercial',
      'mini_cab',
    ]) {
      expect(isCustomerVehicleVisible('passenger', code), isFalse);
    }
  });

  test('Service selection accepts only the three authorized codes', () {
    for (final code in ['ambulance', 'towing', 'jcb']) {
      expect(isCustomerVehicleVisible('service', code), isTrue);
    }
    for (final code in ['crane', 'roadside_assist', 'unknown_service']) {
      expect(isCustomerVehicleVisible('service', code), isFalse);
    }
  });
  test('Logistics allows only the four catalog codes', () {
    for (final code in [
      'three_wheeler',
      'e_rickshaw',
      'electric_tuk_tuk',
      'mini_truck',
      'cargo_407',
    ]) {
      expect(isCustomerVehicleVisible('logistics', code), isFalse);
    }
    for (final code in ['piaggio_ape', 'tata_magic', 'cargo_207', 'tata_407']) {
      expect(isCustomerVehicleVisible('logistics', code), isTrue);
    }
    expect(isCustomerVehicleVisible('premium', 'jcb'), isTrue);
  });
  test('Historical presentation preserves exact codes/images and ignores API extras', () {
    FleetVehicleModel vehicle(String code) => FleetVehicleModel(
      id: code,
      make: '',
      model: code,
      sector: 'logistics',
      category: code,
      fuelRatePerKm: 0,
      loadCapacityKg: 0,
    );
    final items = customerVehiclePresentation('logistics', [
      vehicle('three_wheeler'),
      vehicle('mini_truck'),
      vehicle('tata_407'),
    ]);
    expect(items.map((v) => v['category']), [
      'piaggio_ape',
      'tata_magic',
      'cargo_207',
      'tata_407',
    ]);
    expect(items.map((v) => v['name']), [
      'Piaggio Ape',
      'Tata Magic',
      'Tata 207',
      'Tata 407',
    ]);
    expect(items[2]['image'], 'assets/images/cargo_207_heavy.png');
    expect(passengerVehicles.take(3).map((v) => v['image']), [
      'assets/images/hatchback_clean.jpg',
      'assets/images/sedan_clean.jpg',
      'assets/images/innova_crysta_clean.jpg',
    ]);
  });
}
