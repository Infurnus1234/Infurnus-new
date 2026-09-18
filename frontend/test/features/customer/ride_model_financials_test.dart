import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';

void main() {
  group('RideModel Financials & PIN Verification', () {
    test('displayFare prefers finalFare when available for completed rides', () {
      final json = {
        'id': 'ride-fin-1',
        'customerId': 'cust-123',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'fareEstimate': 450.0,
        'finalFare': 512.50,
        'sector': 'premium',
        'vehicleCategory': 'fortuner',
        'status': 'completed',
        'pin': '8421',
        'pinVerified': true,
        'actualDistanceMeters': 22500,
        'actualFuelCost': 360.0,
        'createdAt': '2026-03-01T10:00:00.000Z',
        'updatedAt': '2026-03-01T11:00:00.000Z',
      };

      final ride = RideModel.fromJson(json);

      expect(ride.displayFare, 512.50);
      expect(ride.finalFare, 512.50);
      expect(ride.fareEstimate, 450.0);
      expect(ride.pinVerified, isTrue);
      expect(ride.actualDistanceMeters, 22500);
      expect(ride.actualFuelCost, 360.0);
      expect(ride.status, RideStatus.completed);
    });

    test('displayFare falls back to fareEstimate when finalFare is not yet reconciled', () {
      final json = {
        'id': 'ride-fin-2',
        'customerId': 'cust-124',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'fareEstimate': 210.0,
        'sector': 'passenger',
        'vehicleCategory': 'sedan',
        'status': 'in_progress',
        'pin': '3391',
        'pinVerified': true,
        'createdAt': '2026-03-01T10:00:00.000Z',
        'updatedAt': '2026-03-01T10:15:00.000Z',
      };

      final ride = RideModel.fromJson(json);

      expect(ride.displayFare, 210.0);
      expect(ride.finalFare, isNull);
      expect(ride.pinVerified, isTrue);
      expect(ride.status, RideStatus.inProgress);
    });

    test('parses trip-based service details without hourly rental pollution', () {
      final json = {
        'id': 'ride-fin-3',
        'customerId': 'cust-125',
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9352, 'longitude': 77.6245},
        'fareEstimate': 1400.0,
        'finalFare': 1400.0,
        'sector': 'service',
        'vehicleCategory': 'jcb',
        'serviceDetails': {
          'serviceType': 'jcb',
          'emergencyLevel': 'standard',
          'description': 'Foundation excavation mobilization',
        },
        'status': 'completed',
        'pin': '7788',
        'pinVerified': true,
        'createdAt': '2026-03-01T10:00:00.000Z',
        'updatedAt': '2026-03-01T12:00:00.000Z',
      };

      final ride = RideModel.fromJson(json);

      expect(ride.sector, 'service');
      expect(ride.vehicleCategory, 'jcb');
      expect(ride.serviceDetails?['serviceType'], 'jcb');
      expect(ride.serviceDetails?.containsKey('workHours'), isFalse);
      expect(ride.displayFare, 1400.0);
    });
  });
}
