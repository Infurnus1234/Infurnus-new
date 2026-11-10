import 'configured_catalog_fixture.dart';

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/core/theme/app_theme.dart';
import 'package:infurnus/core/theme/app_colors.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/specialty_emergency_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/logistics_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/concierge_fleet_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/rentals_screen.dart';

import 'vehicle_fare_ranges_test.dart' show ConnectedSocket, range;
import 'location_independent_booking_test.dart' show mapFixture;
import 'service_booking_test.dart' show serviceQuote;

Widget screen(String label) => switch (label) {
  'service' => const SpecialtyEmergencyScreen(),
  'logistics' => const LogisticsScreen(),
  'premium' => const ConciergeFleetScreen(),
  _ => const RentalsScreen(),
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final fixtures = jsonDecode(
    File('test/fixtures/original_vehicle_catalog.json').readAsStringSync(),
  ) as List;
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  setUpAll(() async {
    final font = FontLoader('Roboto')
      ..addFont(
        Future.value(
          ByteData.sublistView(
            File('test/fixtures/fonts/roboto-regular.ttf').readAsBytesSync(),
          ),
        ),
      );
    await font.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });
  for (final fixture in fixtures) {
    final label = fixture['label'] as String;
    final sector = fixture['sector'] as String;
    final vehicles = fixture['vehicles'] as List;
    testWidgets(
      '$label renders the original catalog and preserves the current background',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.binding.setSurfaceSize(const Size(430, 1100));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final socket = ConnectedSocket();
        final container = ProviderContainer(
          overrides: [
            rideRepositoryProvider.overrideWithValue(
              ConfiguredCatalogRepository(),
            ),
            socketServiceProvider.overrideWithValue(socket),
            dioProvider.overrideWithValue(mapFixture()),
          ],
        );
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: AppTheme.lightTheme.copyWith(
                appBarTheme: AppTheme.lightTheme.appBarTheme.copyWith(
                  titleTextStyle: AppTheme.lightTheme.appBarTheme.titleTextStyle
                      ?.copyWith(fontFamily: 'Roboto'),
                ),
              ),
              home: screen(label),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.runAsync(() async {
          final context = tester.element(find.byType(Scaffold).first);
          for (final asset in fixture['assets']) {
            expect(File(asset as String).existsSync(), isTrue, reason: asset);
            await precacheImage(AssetImage(asset), context);
          }
          for (final image in tester.widgetList<Image>(find.byType(Image))) {
            await precacheImage(image.image, context);
          }
        });
        await tester.pumpAndSettle();
        expect(
          tester.widget<Scaffold>(find.byType(Scaffold).first).backgroundColor,
          AppColors.background,
        );
        for (final vehicle in vehicles) {
          await tester.scrollUntilVisible(
            find.text(vehicle['name']),
            180,
            scrollable: find.byType(Scrollable).last,
          );
          expect(find.text(vehicle['name']), findsOneWidget);
        }
        // The last vertical list is the catalog; the first is the horizontal filter strip.
        final vertical = find.byType(Scrollable).last;
        await tester.drag(vertical, const Offset(0, 3000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/original-$label.png'),
        );
        await tester.pumpWidget(const SizedBox.shrink());
        container.dispose();
        socket.dispose();
      },
    );
    for (final vehicle in vehicles) {
      testWidgets(
        '$label ${vehicle['code']} retains its original code through selection and fare/booking payloads',
        (tester) async {
          final repository = ConfiguredCatalogRepository()
            ..estimate = FareEstimateModel.fromJson(
              sector == 'service' ? serviceQuote() : range(quote: true),
            );
          final socket = ConnectedSocket();
          final container = ProviderContainer(
            overrides: [
              rideRepositoryProvider.overrideWithValue(repository),
              socketServiceProvider.overrideWithValue(socket),
              dioProvider.overrideWithValue(mapFixture()),
            ],
          );
          final router = GoRouter(
            routes: [
              GoRoute(path: '/', builder: (_, __) => screen(label)),
              GoRoute(
                path: '/ride-booking',
                builder: (_, __) =>
                    const Scaffold(body: Text('Booking destination')),
              ),
            ],
          );
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: MaterialApp.router(routerConfig: router),
            ),
          );
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(
            find.text(vehicle['name']),
            180,
            scrollable: find.byType(Scrollable).last,
          );
          await tester.ensureVisible(find.text(vehicle['name']));
          await tester.pumpAndSettle();
          await tester.tap(find.text(vehicle['name']));
          await tester.pumpAndSettle();
          expect(find.text('Booking destination'), findsOneWidget);
          expect(container.read(rideProvider).selectedSector, sector);
          expect(container.read(rideProvider).selectedTier, vehicle['code']);
          final notifier = container.read(rideProvider.notifier);
          notifier.setRoute(
            'Pickup',
            'Destination',
            pickupCoords: const LatLng(25.6, 85.1),
            destCoords: const LatLng(26.1, 85.3),
          );
          await notifier.estimateRouteFare();
          expect(repository.payloads.last['vehicleCategory'], vehicle['code']);
          if (sector != 'service') {
            await notifier.requestRide();
            expect(
              repository.bookingPayload?['vehicleCategory'],
              vehicle['code'],
            );
          }
          await tester.pump(const Duration(milliseconds: 50));
          await tester.pumpWidget(const SizedBox.shrink());
          container.dispose();
          socket.dispose();
          router.dispose();
          await tester.pump(const Duration(milliseconds: 50));
        },
      );
    }
  }
  testWidgets(
    'historical category filters retain the original visible groups',
    (tester) async {
      final socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          socketServiceProvider.overrideWithValue(socket),
          rideRepositoryProvider.overrideWithValue(
            ConfiguredCatalogRepository(),
          ),
          dioProvider.overrideWithValue(mapFixture()),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: SpecialtyEmergencyScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Emergency'));
      await tester.pumpAndSettle();
      expect(find.text('Ambulance'), findsOneWidget);
      expect(find.text('Towing Van'), findsOneWidget);
      expect(find.text('Crane'), findsNothing);
      expect(find.text('JCB'), findsNothing);
      await tester.tap(find.text('Construction'));
      await tester.pumpAndSettle();
      expect(find.text('JCB'), findsOneWidget);
      expect(find.text('Crane'), findsOneWidget);
      expect(find.text('Ambulance'), findsNothing);
      expect(find.text('Towing Van'), findsNothing);
      for (final name in ['Support', 'JCB / Excavator', 'Roadside Assist']) {
        expect(find.text(name), findsNothing);
      }
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      socket.dispose();
    },
  );
}
