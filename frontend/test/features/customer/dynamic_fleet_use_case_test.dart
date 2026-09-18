import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/domain/repositories/ride_repository.dart';
import 'package:infurnus/features/customer/domain/usecases/get_fleet_use_case.dart';

class MockRideRepository implements RideRepository {
  String? lastSectorQuery;
  String? lastCategoryQuery;

  final List<FleetVehicleModel> mockFleet = [
    FleetVehicleModel(
      id: 'mock-1',
      make: 'Toyota',
      model: 'Fortuner',
      sector: 'premium',
      category: 'fortuner',
      fuelRatePerKm: 16.0,
      loadCapacityKg: 0,
    ),
    FleetVehicleModel(
      id: 'mock-2',
      make: 'Mahindra',
      model: 'Thar',
      sector: 'premium',
      category: 'thar',
      fuelRatePerKm: 14.0,
      loadCapacityKg: 0,
    ),
    FleetVehicleModel(
      id: 'mock-3',
      make: 'Tata',
      model: 'Ace',
      sector: 'logistics',
      category: 'mini_truck',
      fuelRatePerKm: 0.0,
      loadCapacityKg: 1000,
    ),
  ];

  @override
  Future<List<FleetVehicleModel>> getFleet({String? sector, String? category}) async {
    lastSectorQuery = sector;
    lastCategoryQuery = category;
    return mockFleet
        .filter((v) =>
            (sector == null || v.sector == sector) &&
            (category == null || v.category == category))
        .toList();
  }

  @override
  Future<RideModel> createRide(Map<String, dynamic> data) => throw UnimplementedError();
  @override
  Future<List<RideModel>> listRides({String? status, int? limit}) => throw UnimplementedError();
  @override
  Future<RideModel> getRide(String id) => throw UnimplementedError();
  @override
  Future<RideModel> cancelRide(String id, String reason) => throw UnimplementedError();
  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) => throw UnimplementedError();
  @override
  Future<Map<String, dynamic>> submitRating({required String rideId, required int rating, String? review}) =>
      throw UnimplementedError();
  @override
  Future<Map<String, dynamic>> initiatePayment(
          {required String rideId, required double amount, required String paymentMethod}) =>
      throw UnimplementedError();
  @override
  Future<List<Map<String, dynamic>>> listPayments({int? limit}) => throw UnimplementedError();
}

extension on List<FleetVehicleModel> {
  Iterable<FleetVehicleModel> filter(bool Function(FleetVehicleModel) test) {
    return where(test);
  }
}

void main() {
  group('GetFleetUseCase', () {
    test('fetches active fleet vehicles filtered by sector and category', () async {
      final mockRepo = MockRideRepository();
      final useCase = GetFleetUseCase(mockRepo);

      final premiumFleet = await useCase(sector: 'premium');

      expect(mockRepo.lastSectorQuery, 'premium');
      expect(mockRepo.lastCategoryQuery, isNull);
      expect(premiumFleet.length, 2);
      expect(premiumFleet.every((v) => v.sector == 'premium'), isTrue);
      expect(premiumFleet[0].category, 'fortuner');
      expect(premiumFleet[0].fuelRatePerKm, 16.0);
    });

    test('fetches single category when both sector and category are provided', () async {
      final mockRepo = MockRideRepository();
      final useCase = GetFleetUseCase(mockRepo);

      final results = await useCase(sector: 'logistics', category: 'mini_truck');

      expect(mockRepo.lastSectorQuery, 'logistics');
      expect(mockRepo.lastCategoryQuery, 'mini_truck');
      expect(results.length, 1);
      expect(results.first.category, 'mini_truck');
      expect(results.first.loadCapacityKg, 1000);
    });
  });
}
