import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/auth/domain/entities/user.dart';
import 'package:infurnus/features/auth/presentation/providers/user_provider.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart'
    as model;
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/ride_booking_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/customer_home_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/booking_history_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/profile_screen.dart';

import '../../recording_maps.dart';
import 'vehicle_fare_ranges_test.dart'
    show RecordingRepository, ConnectedSocket, NoLocation;
import 'location_independent_booking_test.dart' show mapFixture;

class QualityNotifier extends RideNotifier {
  QualityNotifier(super.ref, RideState initial) {
    state = initial;
  }
  @override
  Future<void> fetchRideHistory() async {}
}

class QualityRepository extends RecordingRepository {
  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async => [
    FleetVehicleModel(
      id: 'fixture',
      make: 'Test',
      model: 'Vehicle',
      sector: sector ?? 'rental',
      category:
          {
            'rental': 'hatchback',
            'premium': 'thar',
            'logistics': 'tata_407',
            'service': 'ambulance',
          }[sector] ??
          'hatchback',
      fuelRatePerKm: 0,
      loadCapacityKg: 1000,
    ),
  ];
}

void main() {
  for (final config in [
    (320.0, 740.0, 1.8),
    (390.0, 844.0, 1.3),
    (600.0, 960.0, 2.0),
  ]) {
    for (final screen in [
      'rental',
      'logistics',
      'premium',
      'service',
      'searching',
      'matched',
      'logistics-matched',
      'logistics-completed',
      'arrived',
      'active',
      'completed',
      'cancelled',
      'home',
      'history',
      'details',
      'profile',
    ]) {
      testWidgets('customer $screen ${config.$1} text ${config.$3}', (
        tester,
      ) async {
        tester.view.physicalSize = Size(config.$1, config.$2);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        FlutterSecureStorage.setMockInitialValues({'auth_token': 'audit-only'});
        final originalMaps = GoogleMapsFlutterPlatform.instance;
        GoogleMapsFlutterPlatform.instance = RecordingMaps();
        addTearDown(() => GoogleMapsFlutterPlatform.instance = originalMaps);
        final originalError = FlutterError.onError;
        FlutterError.onError = (details) {
          debugPrint(details.toString());
          originalError?.call(details);
        };
        addTearDown(() => FlutterError.onError = originalError);
        final isLogisticsBooking = screen.startsWith('logistics-');
        final modelStatus =
            {
              'arrived': model.RideStatus.driverArrived,
              'active': model.RideStatus.inProgress,
              'completed': model.RideStatus.completed,
              'logistics-completed': model.RideStatus.completed,
              'cancelled': model.RideStatus.cancelled,
              'searching': model.RideStatus.searching,
            }[screen] ??
            model.RideStatus.driverAssigned;
        final trip = model.RideModel(
          id: '11111111-1111-4111-8111-111111111111',
          customerId: 'customer',
          assignedDriverId: 'driver',
          bookingId: isLogisticsBooking ? '4400382' : '1100382',
          callingNumber: '+919153787859',
          pickup: model.RideLocation(latitude: 25, longitude: 85),
          destination: model.RideLocation(latitude: 26, longitude: 85),
          pickupAddress: 'Gandhi Maidan Patna long selected pickup location',
          destinationAddress: 'A long selected destination building and street in Muzaffarpur district Bihar',
          status: modelStatus,
          sector: isLogisticsBooking ? 'logistics' : 'rental',
          fareEstimate: isLogisticsBooking ? 2003 : 2400,
          logisticsPayment: isLogisticsBooking ? {'totalPaise': 200300,'upfrontPaise': 80100,'finalPaise': 120200,'outstandingPaise': 120200} : null,
          driverDetails: model.DriverDetails(
            id: 'driver',
            name: 'Niranjan Bhardwaj Kumar Singh Long Driver Name',
            rating: 4.8,
          ),
          vehicleDetails: model.VehicleDetails(
            make: 'Toyota',
            model: 'Innova Crysta Long Vehicle Model Name',
            plateNumber: 'BR 01 TEST',
          ),
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );
        final isSetup = [
          'rental',
          'logistics',
          'premium',
          'service',
        ].contains(screen);
        final seed = RideState(
          status: isSetup
              ? RideStatus.initial
              : {
                      'searching': RideStatus.searching,
                      'matched': RideStatus.matched,
                      'arrived': RideStatus.arrived,
                      'active': RideStatus.active,
                      'completed': RideStatus.completed,
                      'logistics-completed': RideStatus.completed,
                      'cancelled': RideStatus.cancelled,
                    }[screen] ??
                    RideStatus.matched,
          selectedSector: isSetup
              ? screen
              : (isLogisticsBooking ? 'logistics' : 'rental'),
          selectedTier:
              {
                'premium': 'thar',
                'logistics': 'tata_407',
                'service': 'ambulance',
              }[screen] ??
              'hatchback',
          currentRide: isSetup ? null : trip,
          pickup: trip.pickupAddress,
          destination: trip.destinationAddress,
          history: [trip],
        );
        final socket = ConnectedSocket();
        final container = ProviderContainer(
          overrides: [
            rideRepositoryProvider.overrideWithValue(QualityRepository()),
            socketServiceProvider.overrideWithValue(socket),
            locationServiceProvider.overrideWithValue(NoLocation()),
            dioProvider.overrideWithValue(mapFixture()),
            rideProvider.overrideWith((ref) => QualityNotifier(ref, seed)),
          ],
        );
        container
            .read(userProvider.notifier)
            .setUser(
              User(
                id: 'customer',
                firstName: 'Niranjan Bhardwaj Kumar',
                lastName: 'Singh Long Customer Name',
                email: 'long.customer.name@example.invalid',
                phone: '+919000005555',
                role: 'customer',
                createdAt: DateTime(2026),
                updatedAt: DateTime(2026),
              ),
            );
        Widget view = switch (screen) {
          'home' => const CustomerHomeScreen(),
          'history' => const BookingHistoryScreen(),
          'details' => const BookingHistoryScreen(),
          'profile' => const ProfileScreen(),
          _ => const RideBookingScreen(),
        };
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(config.$3)),
                child: child!,
              ),
              home: view,
            ),
          ),
        );
        await tester.pump(const Duration(seconds: 1));
        await tester.pump();
        if (screen == 'details') {
          final address = find.text(trip.destinationAddress!);
          await tester.ensureVisible(address.first);
          await tester.tap(address.first);
          await tester.pumpAndSettle();
          expect(find.text('Booking ID: 1100382'), findsOneWidget);
        }
        if (screen == 'logistics-completed') {
          expect(find.text('Pay ₹1202'), findsOneWidget);
          expect(find.text('Pay ₹2003'), findsNothing);
        }
        expect(
          tester.takeException(),
          isNull,
          reason: '$screen ${config.$1} ${config.$3}',
        );
        await tester.pumpWidget(const SizedBox());
        container.dispose();
        socket.dispose();
        await tester.pump();
      });
    }
  }
}
