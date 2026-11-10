import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/logistics_screen.dart';
import 'package:infurnus/features/customer/domain/repositories/ride_repository.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';

class _FakeRideRepo implements RideRepository {
  FareEstimateModel? estimate;

  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) async =>
      estimate ??
      FareEstimateModel.unavailable(
        "We're sorry, but this vehicle is not available for booking yet.",
      );

  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async => [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _DummyLocation extends LocationService {
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  testWidgets(
    'LogisticsScreen displays named unavailable vehicle banner and badge',
    (tester) async {
      final fakeRepo = _FakeRideRepo()
        ..estimate = FareEstimateModel.unavailable(
          "We're sorry, but this vehicle is not available for booking yet. We'll be introducing it soon. Please check back later.",
        );

      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(fakeRepo),
          locationServiceProvider.overrideWithValue(_DummyLocation()),
        ],
      );
      addTearDown(container.dispose);

      final notifier = container.read(rideProvider.notifier);
      notifier.setRoute(
        'Origin',
        'Destination',
        pickupCoords: const LatLng(12, 77),
        destCoords: const LatLng(13, 78),
        sector: 'logistics',
        vehicleCategory: 'tata_magic',
      );
      await notifier.estimateRouteFare();

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: LogisticsScreen()),
        ),
      );
      await tester.pumpAndSettle();

      // Verify the banner names the specific unavailable vehicle
      expect(find.text('Tata Magic Unavailable'), findsOneWidget);
      expect(
        find.text(
          "We're sorry, but this vehicle is not available for booking yet. We'll be introducing it soon. Please check back later.",
        ),
        findsOneWidget,
      );

      // Verify the vehicle card has the Unavailable badge
      expect(find.text('Unavailable'), findsOneWidget);

      // Tapping the unavailable vehicle shows a snackbar rather than navigating
      await tester.tap(find.text('Tata Magic').last);
      await tester.pumpAndSettle();
      expect(
        find.text('Tata Magic is currently unavailable for booking.'),
        findsOneWidget,
      );
    },
  );
}
