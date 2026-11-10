import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/ride_booking_screen.dart';

import 'passenger_vehicle_exclusion_test.dart' show NoLocation;
import 'vehicle_fare_ranges_test.dart'
    show RecordingRepository, ConnectedSocket, range;

void main() {
  testWidgets(
    'Premium duration menu exposes every whole hour from one through twenty-four',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      final socket = ConnectedSocket();
      final repo = RecordingRepository()
        ..estimate = FareEstimateModel.fromJson(range(quote: true));
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(repo),
          socketServiceProvider.overrideWithValue(socket),
          locationServiceProvider.overrideWithValue(NoLocation()),
        ],
      );
      container.read(rideProvider.notifier).selectSector('premium');
      container.read(rideProvider.notifier).selectTier('thar');
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: RideBookingScreen()),
        ),
      );
      await tester.pump();
      final field = tester.widget<DropdownButton<int>>(
        find.byType(DropdownButton<int>),
      );
      expect(
        field.items!.map((item) => item.value).toList(),
        List.generate(24, (index) => index + 1),
      );
      for (var hours = 1; hours <= 24; hours++) {
        tester
            .widget<DropdownButton<int>>(find.byType(DropdownButton<int>))
            .onChanged!(hours);
        await tester.pump();
        expect(container.read(rideProvider).rentalDetails?['hours'], hours);
      }
      await tester.pumpWidget(const SizedBox());
      container.dispose();
      socket.dispose();
    },
  );
  testWidgets('Rental exposes 1-12 hours and sends exact extended hours', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    final socket = ConnectedSocket();
    final repo = RecordingRepository()
      ..estimate = FareEstimateModel.fromJson(range(quote: true));
    final container = ProviderContainer(
      overrides: [
        rideRepositoryProvider.overrideWithValue(repo),
        socketServiceProvider.overrideWithValue(socket),
        locationServiceProvider.overrideWithValue(NoLocation()),
      ],
    );
    container.read(rideProvider.notifier).selectSector('rental');
    container.read(rideProvider.notifier).selectTier('sedan');
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: RideBookingScreen()),
      ),
    );
    await tester.pump();
    final field = tester.widget<DropdownButton<int>>(
      find.byType(DropdownButton<int>),
    );
    expect(field.items!.map((item) => item.value).toList(), [
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
    ]);
    field.onChanged!(13);
    await tester.pumpAndSettle();
    expect(find.text('Rental duration'), findsOneWidget);
    await tester.enterText(
      find.byWidgetPredicate(
        (w) =>
            w is TextField && w.decoration?.labelText == 'Hours (13 or more)',
      ),
      '17',
    );
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    expect(container.read(rideProvider).rentalDetails?['hours'], 17);
    await tester.pumpWidget(const SizedBox());
    container.dispose();
    socket.dispose();
  });
}
