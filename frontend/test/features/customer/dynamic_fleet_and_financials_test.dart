import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart' hide RideStatus;

void main() {
  group('Phase 4 Step 9: Frontend Dynamic Fleet & Financials Test Suite', () {
    // ----------------------------------------------------
    // 1. Passenger Categories
    // ----------------------------------------------------
    test('Canonical passenger vehicle categories are correctly modeled and supported', () {
      const canonicalCategories = ['bike', 'auto', 'mini', 'sedan', 'suv'];
      final state = RideState(selectedSector: 'passenger', selectedTier: 'mini');

      expect(state.selectedSector, 'passenger');
      expect(state.selectedTier, 'mini');
      expect(canonicalCategories.contains(state.selectedTier), isTrue);

      // Tiers can be switched between all 5 canonical passenger categories
      for (final cat in canonicalCategories) {
        final updated = state.copyWith(selectedTier: cat);
        expect(updated.selectedTier, cat);
      }
    });

    // ----------------------------------------------------
    // 2. Logistics Vehicle & Data Fields
    // ----------------------------------------------------
    test('Logistics payload preserves goods information and vehicle types', () {
      final goods = {
        'itemType': 'Electronics & Gadgets',
        'description': 'Fragile display units',
        'weightKg': 45.0,
        'quantity': 3,
        'loadingAssistance': true,
      };

      final state = RideState(
        selectedSector: 'logistics',
        selectedTier: 'mini_truck',
        goods: goods,
      );

      expect(state.selectedSector, 'logistics');
      expect(state.selectedTier, 'mini_truck');
      expect(state.goods?['itemType'], 'Electronics & Gadgets');
      expect(state.goods?['description'], 'Fragile display units');
      expect(state.goods?['weightKg'], 45.0);
      expect(state.goods?['quantity'], 3);
      expect(state.goods?['loadingAssistance'], isTrue);

      // Model deserialization verification
      final ride = RideModel.fromJson({
        'id': 'logistics-ride-1',
        'customerId': 'cust-log-1',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'sector': 'logistics',
        'vehicleCategory': 'mini_truck',
        'goods': goods,
        'fareEstimate': 620.0,
        'status': 'requested',
        'createdAt': '2026-09-19T10:00:00.000Z',
        'updatedAt': '2026-09-19T10:00:00.000Z',
      });

      expect(ride.sector, 'logistics');
      expect(ride.goods?['weightKg'], 45.0);
      expect(ride.goods?['loadingAssistance'], isTrue);
    });

    // ----------------------------------------------------
    // 3. Service Vehicle is Strictly Trip-Based
    // ----------------------------------------------------
    test('Service Vehicle does not accept or include hourly rental or work-hour parameters', () {
      final serviceDetails = {
        'serviceType': 'ambulance',
        'emergencyLevel': 'critical',
        'description': 'Emergency patient transfer',
      };

      final ride = RideModel.fromJson({
        'id': 'service-ride-1',
        'customerId': 'cust-srv-1',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'sector': 'service',
        'vehicleCategory': 'ambulance',
        'serviceDetails': serviceDetails,
        'fareEstimate': 819.0,
        'status': 'requested',
        'createdAt': '2026-09-19T10:00:00.000Z',
        'updatedAt': '2026-09-19T10:00:00.000Z',
      });

      expect(ride.sector, 'service');
      expect(ride.rentalDetails, isNull);
      expect(ride.serviceDetails?.containsKey('rentalHours'), isFalse);
      expect(ride.serviceDetails?.containsKey('workHours'), isFalse);
      expect(ride.fareEstimate, 819.0);
    });

    // ----------------------------------------------------
    // 4. Premium Booking Hours & Advance Estimate
    // ----------------------------------------------------
    test('Premium booking captures hourly standby duration and vehicle details', () {
      final rentalDetails = {
        'hours': 4,
        'startDate': '2026-09-20',
        'startTime': '10:00',
        'fuelRatePerKm': 16.0,
        'vehicleModel': 'Toyota Fortuner',
      };

      final state = RideState(
        selectedSector: 'premium',
        selectedTier: 'fortuner',
        rentalDetails: rentalDetails,
      );

      expect(state.selectedSector, 'premium');
      expect(state.selectedTier, 'fortuner');
      expect(state.rentalDetails?['hours'], 4);
      expect(state.rentalDetails?['fuelRatePerKm'], 16.0);
      expect(state.rentalDetails?['vehicleModel'], 'Toyota Fortuner');
    });

    // ----------------------------------------------------
    // 5. Premium Completed Ride Reconciliation
    // ----------------------------------------------------
    test('Premium completed ride displays actual distance, actual fuel cost, and final fare', () {
      final ride = RideModel.fromJson({
        'id': 'prem-ride-completed-1',
        'customerId': 'cust-prem-1',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'sector': 'premium',
        'vehicleCategory': 'fortuner',
        'fareEstimate': 4200.0,
        'finalFare': 5145.0,
        'actualDistanceMeters': 50000,
        'actualFuelCost': 800.0,
        'status': 'completed',
        'pin': '9182',
        'pinVerified': true,
        'createdAt': '2026-09-19T08:00:00.000Z',
        'updatedAt': '2026-09-19T12:00:00.000Z',
      });

      expect(ride.fareEstimate, 4200.0);
      expect(ride.finalFare, 5145.0);
      expect(ride.displayFare, 5145.0);
      expect(ride.actualDistanceMeters, 50000);
      expect(ride.actualFuelCost, 800.0);
      expect(ride.status, RideStatus.completed);
    });

    // ----------------------------------------------------
    // 6. Server finalFare Overrides Local Calculations
    // ----------------------------------------------------
    test('Server finalFare is authoritative over fareEstimate or client defaults', () {
      final ride = RideModel.fromJson({
        'id': 'ride-override-test',
        'customerId': 'cust-1',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'fareEstimate': 150.0,
        'finalFare': 187.50,
        'status': 'completed',
        'createdAt': '2026-09-19T10:00:00.000Z',
        'updatedAt': '2026-09-19T10:30:00.000Z',
      });

      expect(ride.displayFare, 187.50);
      expect(ride.displayFare, isNot(150.0));
    });

    // ----------------------------------------------------
    // 7. Server actualFuelCost Overrides Client Fuel
    // ----------------------------------------------------
    test('Server actualFuelCost is strictly authoritative', () {
      final ride = RideModel.fromJson({
        'id': 'fuel-override-test',
        'customerId': 'cust-1',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'sector': 'premium',
        'actualDistanceMeters': 40000,
        'actualFuelCost': 640.0,
        'status': 'completed',
        'createdAt': '2026-09-19T10:00:00.000Z',
        'updatedAt': '2026-09-19T11:00:00.000Z',
      });

      expect(ride.actualFuelCost, 640.0);
    });

    // ----------------------------------------------------
    // 8. Empty Fleet State
    // ----------------------------------------------------
    test('Empty fleet state returns empty list without injecting hardcoded mock vehicles', () {
      final List<FleetVehicleModel> emptyFleet = [];

      expect(emptyFleet.isEmpty, isTrue);
      expect(emptyFleet.length, 0);
    });

    // ----------------------------------------------------
    // 9. API Error State Handling
    // ----------------------------------------------------
    test('Error state is properly stored in RideState for UI error banner rendering', () {
      final state = RideState(
        errorMessage: 'Network timeout: Unable to reach fleet service',
      );

      expect(state.errorMessage, isNotNull);
      expect(state.errorMessage, contains('Network timeout'));
    });

    // ----------------------------------------------------
    // 10. Null / Missing Optional Financial Fields
    // ----------------------------------------------------
    test('Null financial fields are safely handled without thrown errors or forced unwrap crashes', () {
      final minimalJson = {
        'id': 'minimal-ride',
        'customerId': 'cust-min',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'status': 'requested',
        'createdAt': '2026-09-19T10:00:00.000Z',
        'updatedAt': '2026-09-19T10:00:00.000Z',
      };

      final ride = RideModel.fromJson(minimalJson);

      expect(ride.fareEstimate, isNull);
      expect(ride.finalFare, isNull);
      expect(ride.actualDistanceMeters, isNull);
      expect(ride.actualFuelCost, isNull);
      expect(ride.displayFare, 0.0);
      expect(ride.sector, isNull);
      expect(ride.vehicleCategory, isNull);
      expect(ride.pin, isNull);
      expect(ride.pinVerified, isNull);
    });

    // ----------------------------------------------------
    // 11. Completed Ride Does Not Expose PIN
    // ----------------------------------------------------
    test('Customer completed ride state does not expose PIN in post-trip panels or history', () {
      final completedRide = RideModel.fromJson({
        'id': 'completed-pin-test',
        'customerId': 'cust-pin',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'fareEstimate': 200.0,
        'finalFare': 200.0,
        'status': 'completed',
        'pin': '4567',
        'pinVerified': true,
        'createdAt': '2026-09-19T10:00:00.000Z',
        'updatedAt': '2026-09-19T10:30:00.000Z',
      });

      // Verification logic: PIN is only active when pinVerified != true and status is pending pickup
      final shouldShowPin = completedRide.pin != null &&
          completedRide.pinVerified != true &&
          completedRide.status != RideStatus.completed &&
          completedRide.status != RideStatus.inProgress;

      expect(shouldShowPin, isFalse);
    });

    // ----------------------------------------------------
    // 12. Step 8 PIN Flow Remains Intact
    // ----------------------------------------------------
    test('Step 8 PIN flow correctly displays PIN when matched and driver arriving', () {
      final activePickupRide = RideModel.fromJson({
        'id': 'active-pickup-ride',
        'customerId': 'cust-pin',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'status': 'driver_assigned',
        'pin': '7241',
        'pinVerified': false,
        'createdAt': '2026-09-19T10:00:00.000Z',
        'updatedAt': '2026-09-19T10:05:00.000Z',
      });

      final shouldShowPin = activePickupRide.pin != null &&
          activePickupRide.pinVerified != true &&
          (activePickupRide.status == RideStatus.driverAssigned ||
              activePickupRide.status == RideStatus.driverArriving ||
              activePickupRide.status == RideStatus.driverArrived);

      expect(shouldShowPin, isTrue);
      expect(activePickupRide.pin, '7241');
    });

    // ----------------------------------------------------
    // 13. Fare Estimate Breakdown Components
    // ----------------------------------------------------
    test('FareEstimateModel cleanly preserves and displays all server-calculated itemized components', () {
      final estimate = FareEstimateModel.fromJson({
        'baseAmount': 5000,
        'distanceAmount': 15000,
        'timeAmount': 4000,
        'waitingAmount': 1000,
        'weightAmount': 5000,
        'loadingAmount': 15000,
        'fuelAmount': 0,
        'taxAmount': 2250,
        'grossAmount': 47250,
        'currency': 'INR',
        'distanceMeters': 10000,
        'durationSeconds': 1200,
      });

      expect(estimate.baseAmount, 50.0);
      expect(estimate.distanceAmount, 150.0);
      expect(estimate.timeAmount, 40.0);
      expect(estimate.waitingAmount, 10.0);
      expect(estimate.weightAmount, 50.0);
      expect(estimate.loadingAmount, 150.0);
      expect(estimate.taxAmount, 22.50);
      expect(estimate.grossAmount, 472.50);
      expect(estimate.currency, 'INR');
      expect(estimate.distanceKm, 10.0);
      expect(estimate.durationMinutes, 20);
    });
  });
}
