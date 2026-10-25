import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/domain/repositories/ride_repository.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';

class _RecordingRideRepository implements RideRepository {
  final payloads = <Map<String, dynamic>>[];
  final estimates = <Completer<FareEstimateModel>>[];

  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) {
    payloads.add(data);
    final estimate = Completer<FareEstimateModel>();
    estimates.add(estimate);
    return estimate.future;
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

FareEstimateModel _estimate(double amount) => FareEstimateModel(
  grossAmount: amount,
  baseAmount: amount,
  distanceAmount: 0,
  timeAmount: 0,
  distanceKm: 1,
  durationMinutes: 3,
  currency: 'INR',
);

void main() {
  test(
    'late fare completion after disposal does not update provider state',
    () async {
      final repository = _RecordingRideRepository();
      final container = ProviderContainer(
        overrides: [rideRepositoryProvider.overrideWithValue(repository)],
      );
      final notifier = container.read(rideProvider.notifier);
      notifier.setRoute(
        'A',
        'B',
        pickupCoords: const LatLng(12, 77),
        destCoords: const LatLng(13, 78),
        vehicleCategory: 'bike',
      );
      final pending = notifier.estimateRouteFare();
      container.dispose();
      repository.estimates.single.complete(_estimate(40));
      expect(await pending, isFalse);
    },
  );

  test(
    'sends current route coordinates and selected category to fare API',
    () async {
      final repository = _RecordingRideRepository();
      final container = ProviderContainer(
        overrides: [rideRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final notifier = container.read(rideProvider.notifier);

      // setDestinationCoords triggers an initial estimate (with default tier).
      // selectTier('bike') triggers the estimate we care about.
      notifier.setPickupCoords(const LatLng(12.3, 45.6));
      notifier.setDestinationCoords(const LatLng(23.4, 56.7));
      notifier.selectTier('bike');
      final estimateFuture = notifier.estimateRouteFare();
      repository.estimates.last.complete(_estimate(40));

      expect(await estimateFuture, isTrue);
      // The last payload must use the explicitly selected 'bike' category.
      expect(repository.payloads.last, {
        'pickup': {'latitude': 12.3, 'longitude': 45.6},
        'destination': {'latitude': 23.4, 'longitude': 56.7},
        'sector': 'passenger',
        'vehicleCategory': 'bike',
      });
    },
  );

  test(
    'ignores an older fare response after vehicle selection changes',
    () async {
      final repository = _RecordingRideRepository();
      final container = ProviderContainer(
        overrides: [rideRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final notifier = container.read(rideProvider.notifier);

      // estimates[0] = initial hatchback (fired by setDestinationCoords)
      // estimates[1] = bike  (stale — should be ignored)
      // estimates[2] = suv   (current selection — should win)
      notifier.setPickupCoords(const LatLng(12.3, 45.6));
      notifier.setDestinationCoords(const LatLng(23.4, 56.7));
      notifier.selectTier('bike');
      notifier.selectTier('suv');

      // Complete suv (current) first; then complete stale bike + initial.
      repository.estimates[2].complete(_estimate(100));
      repository.estimates[1].complete(_estimate(40));
      repository.estimates[0].complete(_estimate(20));
      await Future<void>.delayed(Duration.zero);

      expect(container.read(rideProvider).selectedTier, 'suv');
      expect(container.read(rideProvider).fare, 100);

      // The last two explicit selectTier calls sent bike then suv to the API.
      final categories = repository.payloads
          .map((p) => p['vehicleCategory'])
          .toList();
      expect(categories.last, 'suv');
      expect(categories[categories.length - 2], 'bike');
    },
  );
}
