import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'dart:async';

import 'package:infurnus/features/customer/data/models/ride_model.dart'
    as model;
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';

import 'vehicle_fare_ranges_test.dart'
    show RecordingRepository, ConnectedSocket;

class _PendingRead extends RecordingRepository {
  final pending = Completer<model.RideModel>();
  @override
  Future<model.RideModel> getRide(String id) => pending.future;
}

void main() {
  test(
    'an old cancelled-ride response cannot reopen after Book Another Ride',
    () async {
      final repo = _PendingRead(), socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(repo),
          socketServiceProvider.overrideWithValue(socket),
        ],
      );
      final notifier = container.read(rideProvider.notifier);
      final read = notifier.getRideDetails('cancelled');
      notifier.resetRide();
      repo.pending.complete(
        model.RideModel(
          id: 'cancelled',
          customerId: 'customer',
          pickup: model.RideLocation(latitude: 25, longitude: 85),
          destination: model.RideLocation(latitude: 26, longitude: 85),
          status: model.RideStatus.cancelled,
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        ),
      );
      await read;
      expect(container.read(rideProvider).currentRide, isNull);
      expect(container.read(rideProvider).status, RideStatus.initial);
      container.dispose();
      socket.dispose();
    },
  );
  test(
    'Thar defaults to six hours and preserves an explicitly selected duration',
    () {
      final socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(RecordingRepository()),
          socketServiceProvider.overrideWithValue(socket),
        ],
      );
      final notifier = container.read(rideProvider.notifier);
      notifier.selectSector('premium');
      notifier.selectTier('thar');
      expect(container.read(rideProvider).rentalDetails?['hours'], 6);
      for (final hours in [5, 6, 7]) {
        notifier.setRentalDetails({'hours': hours});
        notifier.selectTier('thar');
        expect(container.read(rideProvider).rentalDetails?['hours'], hours);
      }
      container.dispose();
      socket.dispose();
    },
  );
}
