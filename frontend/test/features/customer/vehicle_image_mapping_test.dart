import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/shared/widgets/vehicle_visual_image.dart';
import 'package:infurnus/features/customer/presentation/widgets/vehicle_category_visual.dart';

void main() {
  group('Comprehensive Vehicle Image Mapping Tests', () {
    test('Passenger Rides exact mappings', () {
      expect(
        VehicleVisualImage.getAssetPath('Hatchback', 'rides'),
        'assets/images/hatchback.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Baleno', 'rides'),
        'assets/images/hatchback.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Sedan', 'passenger'),
        'assets/images/sedan.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Innova Crysta', 'rides'),
        'assets/images/innova_crysta.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Winger', 'rides'),
        'assets/images/winger.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Mini / Commercial', 'commercial'),
        'assets/images/mini_commercial.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Auto', 'auto'),
        'assets/images/auto_rickshaw.png',
      );
      expect(
        VehicleVisualImage.getAssetPath('Bike', 'bike'),
        'assets/images/bike_motorcycle.png',
      );
    });

    test('Logistics exact mappings', () {
      expect(
        VehicleVisualImage.getAssetPath('Tata Magic', 'logistics'),
        'assets/images/tata_magic_cream.png',
      );
      expect(
        VehicleVisualImage.getAssetPath('207 Cargo', 'logistics'),
        'assets/images/cargo_207_normal.png',
      );
      expect(
        VehicleVisualImage.getAssetPath('207 Heavy Cargo', 'logistics'),
        'assets/images/cargo_207_heavy.png',
      );
      expect(
        VehicleVisualImage.getAssetPath('407 Cargo', 'logistics'),
        'assets/images/cargo_407.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Mini Truck', 'logistics'),
        'assets/images/mini_truck.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('E-Rickshaw', 'logistics'),
        'assets/images/e_rickshaw_green_white.png',
      );
      expect(
        VehicleVisualImage.getAssetPath('Electric Tuk-Tuk', 'logistics'),
        'assets/images/e_rickshaw_passenger.png',
      );
    });

    test('Specialty & Emergency exact mappings', () {
      expect(
        VehicleVisualImage.getAssetPath('Ambulance', 'emergency'),
        'assets/images/ambulance_van.png',
      );
      expect(
        VehicleVisualImage.getAssetPath('Towing Van', 'emergency'),
        'assets/images/towing_van.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('JCB / Excavator', 'specialty'),
        'assets/images/jcb_excavator.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Road Roller', 'construction'),
        'assets/images/road_roller.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Crane', 'construction'),
        'assets/images/crane_truck.png',
      );
      expect(
        VehicleVisualImage.getAssetPath('Garbage Truck', 'logistics'),
        'assets/images/garbage_dump_truck.png',
      );
    });

    test('Concierge Fleet exact mappings', () {
      expect(
        VehicleVisualImage.getAssetPath('Innova Crysta', 'premium'),
        'assets/images/innova_crysta.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Toyota Fortuner', 'suv'),
        'assets/images/fortuner_visual.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Force Traveller', 'rides'),
        'assets/images/force_urbania.jpg',
      );
      expect(
        VehicleVisualImage.getAssetPath('Mahindra Thar', 'suv'),
        'assets/images/thar_visual.webp',
      );
      expect(
        VehicleVisualImage.getAssetPath('Scorpio N', 'suv'),
        'assets/images/scorpio_n_white.png',
      );
    });

    test('VehicleCategoryConfig defaults', () {
      expect(
        VehicleCategoryConfig.getConfig(VehicleCategoryType.rides).assetImagePath,
        'assets/images/sedan.jpg',
      );
      expect(
        VehicleCategoryConfig.getConfig(VehicleCategoryType.logistics).assetImagePath,
        'assets/images/mini_commercial.jpg',
      );
      expect(
        VehicleCategoryConfig.getConfig(VehicleCategoryType.auto).assetImagePath,
        'assets/images/auto_rickshaw.png',
      );
      expect(
        VehicleCategoryConfig.getConfig(VehicleCategoryType.bike).assetImagePath,
        'assets/images/bike_motorcycle.png',
      );
    });
  });
}
