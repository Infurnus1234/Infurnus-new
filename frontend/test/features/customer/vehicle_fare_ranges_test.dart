import 'package:dio/dio.dart';
import 'package:geolocator/geolocator.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/shared/widgets/infurnus_button.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart' as ride;
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/presentation/screens/logistics_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/errors/failures.dart';
import 'package:infurnus/features/customer/data/datasources/ride_remote_data_source.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/data/repositories/ride_repository_impl.dart';
import 'package:infurnus/features/customer/domain/repositories/ride_repository.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/widgets/fare_range_details.dart';

const availability =
    "We’re sorry, but this vehicle is not available for booking yet. We’ll be introducing it soon. Please check back later.";
Map<String, dynamic> fixed(int gross) => {
  'grossAmount': gross,
  'baseAmount': 1500,
  'distanceAmount': gross - 1500,
  'timeAmount': 0,
  'distanceMeters': 1000,
  'durationSeconds': 60,
  'currency': 'INR',
};
Map<String, dynamic> range({bool open = false, bool quote = false}) => {
  'estimateType': 'range',
  'bookable': quote,
  'message': 'A fixed quote is required before booking.',
  'currency': 'INR',
  'distanceMeters': 1000,
  'durationSeconds': 60,
  'pricing': {
    'baseFare': {'minimum': 1500, 'maximum': open ? null : 2000},
    'perKmRate': {'minimum': 500, 'maximum': 800},
  },
  'estimatedFare': {
    'minimum': fixed(2000),
    'maximum': open ? null : fixed(2800),
  },
  if (quote) 'bookingFare': fixed(2400),
};

class NoLocation extends LocationService {
  @override
  Future<Position?> getCurrentPosition() async => null;
}

class ConnectedSocket extends SocketService {
  @override
  SocketConnectionState get currentState => SocketConnectionState.connected;
  @override
  void joinRide(String rideId) {}
}

class RecordingRepository implements RideRepository {
  Map<String, dynamic>? bookingPayload;
  @override
  Future<ride.RideModel> createRide(Map<String, dynamic> data) async {
    creates++;
    bookingPayload = data;
    return ride.RideModel(
      id: 'ride',
      customerId: 'customer',
      pickup: ride.RideLocation(latitude: 12, longitude: 77),
      destination: ride.RideLocation(latitude: 13, longitude: 78),
      fareEstimate: estimate.bookingAmount,
      vehicleCategory: data['vehicleCategory'] as String,
      status: ride.RideStatus.searching,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );
  }

  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async => [
    FleetVehicleModel(
      id: 'vehicle',
      make: 'Tata',
      model: 'Ace',
      sector: 'logistics',
      category: 'mini_truck',
      fuelRatePerKm: 0,
      loadCapacityKg: 500,
    ),
  ];
  final payloads = <Map<String, dynamic>>[];
  FareEstimateModel estimate = FareEstimateModel.fromJson(range());
  int creates = 0;
  Object? error;
  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) async {
    payloads.add(data);
    if (error != null) throw error!;
    return estimate;
  }

  @override
  noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #createRide) creates++;
    return super.noSuchMethod(invocation);
  }
}

class FailingDataSource implements RideRemoteDataSource {
  final String code;
  FailingDataSource(this.code);
  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) async {
    throw DioException(
      requestOptions: RequestOptions(path: '/fares/estimate'),
      response: Response(
        requestOptions: RequestOptions(path: '/fares/estimate'),
        statusCode: 422,
        data: {
          'success': false,
          'error': {
            'code': code,
            'message': code == 'FARE_CONFIGURATION_MISSING'
                ? availability
                : 'Temporary pricing error',
          },
        },
      ),
    );
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class MalformedDataSource extends FailingDataSource {
  MalformedDataSource() : super('');
  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) async =>
      FareEstimateModel.fromJson(null);
}

void main() {
  test('malformed backend fare is a professional retry error, never availability or zero', () async {
    final repository = RideRepositoryImpl(MalformedDataSource());
    await expectLater(
      repository.estimateFare({}),
      throwsA(
        isA<ServerFailure>().having(
          (e) => e.message,
          'message',
          'We could not load a valid fare. Please try again.',
        ),
      ),
    );
  });
  test('invalid constructed booking amounts cannot enable confirmation', () {
    for (final amount in [double.nan, double.infinity, -1.0]) {
      final fare = FareEstimateModel(
        grossAmount: amount,
        baseAmount: 0,
        distanceAmount: 0,
        timeAmount: 0,
        distanceKm: 1,
        durationMinutes: 1,
        currency: 'INR',
      );
      expect(fare.bookingAmount, isNull);
    }
  });
  test('rejects null/non-map fares, missing route metadata and invalid currency/flags', () {
    for (final value in [
      null,
      [],
      'fare',
      {...fixed(2000), 'distanceMeters': null},
      {...fixed(2000), 'durationSeconds': null},
      {...fixed(2000), 'currency': 'USD'},
      {...fixed(2000), 'bookable': 'true'},
    ]) {
      expect(() => FareEstimateModel.fromJson(value), throwsFormatException);
    }
    expect(
      FareEstimateModel.fromJson({...fixed(2000), 'bookable': false})
          .bookingAmount,
      isNull,
    );
  });
  test('successful confirmation uses backend quote and forwards waiting input without a client fare', () async {
    final repository = RecordingRepository()
      ..estimate = FareEstimateModel.fromJson(range(quote: true));
    final socket = ConnectedSocket();
    final container = ProviderContainer(
      overrides: [
        rideRepositoryProvider.overrideWithValue(repository),
        socketServiceProvider.overrideWithValue(socket),
      ],
    );
    addTearDown(() {
      container.dispose();
      socket.dispose();
    });
    final notifier = container.read(rideProvider.notifier);
    notifier.setRoute(
      'A',
      'B',
      pickupCoords: const LatLng(12, 77),
      destCoords: const LatLng(13, 78),
      vehicleCategory: 'bike',
    );
    notifier.setWaitingMinutes(5);
    await notifier.estimateRouteFare();
    await notifier.requestRide();
    expect(repository.creates, 1);
    expect(repository.bookingPayload!['waitingMinutes'], 5);
    expect(repository.bookingPayload!.containsKey('fareEstimate'), isFalse);
    expect(container.read(rideProvider).currentRide!.fareEstimate, 24);
    expect(container.read(rideProvider).status, RideStatus.searching);
  });
  testWidgets(
    'real logistics confirmation is disabled for unavailable fares and enabled for a backend quote',
    (tester) async {
      final repository = RecordingRepository()
        ..estimate = FareEstimateModel.unavailable(availability);
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(repository),
          locationServiceProvider.overrideWithValue(NoLocation()),
        ],
      );
      addTearDown(container.dispose);
      final notifier = container.read(rideProvider.notifier);
      notifier.setRoute(
        'Warehouse',
        'Customer',
        pickupCoords: const LatLng(12, 77),
        destCoords: const LatLng(13, 78),
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
      );
      await notifier.estimateRouteFare();
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: LogisticsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      var button = tester.widget<InfurnusButton>(find.byType(InfurnusButton));
      expect(button.onPressed, isNull);
      expect(find.text(availability), findsWidgets);
      expect(find.textContaining('₹0'), findsNothing);
      repository.estimate = FareEstimateModel.fromJson(range(quote: true));
      await notifier.estimateRouteFare();
      await tester.pumpAndSettle();
      button = tester.widget<InfurnusButton>(find.byType(InfurnusButton));
      expect(button.onPressed, isNotNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  test(
    'parses actual Tata 407 base and rate without an invented upper total',
    () {
      final json = range(open: true);
      json['pricing'] = {
        'baseFare': {'minimum': 77500, 'maximum': null},
        'perKmRate': {'minimum': 2500, 'maximum': 3000},
      };
      json['estimatedFare'] = {
        'minimum': {
          ...fixed(84000),
          'baseAmount': 77500,
          'distanceAmount': 2500,
          'timeAmount': 0,
          'taxAmount': 4000,
        },
        'maximum': null,
      };
      final estimate = FareEstimateModel.fromJson(json);
      expect(estimate.displayFare, '₹840.00+');
      expect(estimate.pricingDescription, 'Base ₹775.00+; ₹25.00–₹30.00/km');
      expect(estimate.bookingAmount, isNull);
    },
  );
  test('rejects malformed scalar and nested quote amounts', () {
    for (final value in [
      <String, dynamic>{},
      {...fixed(2000), 'grossAmount': -1},
      {...fixed(2000), 'grossAmount': double.nan},
      {...fixed(2000), 'grossAmount': 1.5},
      {'estimateType': 'unknown'},
      {
        ...range(),
        'estimatedFare': {'minimum': {}, 'maximum': null},
      },
      {...range(quote: true), 'bookingFare': {}},
      {
        ...range(),
        'estimatedFare': {'minimum': fixed(2800), 'maximum': fixed(2000)},
      },
      {
        ...range(),
        'estimatedFare': {'minimum': fixed(2000), 'maximum': null},
      },
      {...range(quote: true), 'bookingFare': fixed(9000)},
    ]) {
      expect(() => FareEstimateModel.fromJson(value), throwsFormatException);
    }
  });
  test(
    'identical atomic updates and pending requests do not duplicate requests',
    () async {
      final repository = RecordingRepository();
      final container = ProviderContainer(
        overrides: [rideRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final notifier = container.read(rideProvider.notifier);
      void route() => notifier.setRoute(
        'A',
        'B',
        pickupCoords: const LatLng(12, 77),
        destCoords: const LatLng(13, 78),
        vehicleCategory: 'bike',
      );
      route();
      route();
      final first = notifier.estimateRouteFare();
      final second = notifier.estimateRouteFare();
      await Future.wait([first, second]);
      expect(repository.payloads.length, 1);
      await notifier.requestRide();
      expect(repository.payloads.length, 1);
      expect(repository.creates, 0);
    },
  );
  test('rejects malformed range instead of displaying a zero fare', () {
    expect(
      () => FareEstimateModel.fromJson({'estimateType': 'range'}),
      throwsFormatException,
    );
  });
  test('preserves legacy scalar money conversion', () {
    final estimate = FareEstimateModel.fromJson(fixed(2000));
    expect(estimate.grossAmount, 20);
    expect(estimate.bookingAmount, 20);
    expect(estimate.displayFare, '₹20.00');
  });
  test('parses and displays a bounded range without a booking amount', () {
    final estimate = FareEstimateModel.fromJson(range());
    expect(estimate.displayFare, '₹20.00–₹28.00');
    expect(estimate.bookingAmount, isNull);
    expect(estimate.bookable, isFalse);
    expect(estimate.pricingDescription, contains('₹5.00–₹8.00/km'));
  });
  test('preserves open upper bound', () {
    expect(
      FareEstimateModel.fromJson(range(open: true)).displayFare,
      '₹20.00+',
    );
  });
  test('uses explicit booking quote rather than either range bound', () {
    final estimate = FareEstimateModel.fromJson(range(quote: true));
    expect(estimate.bookingAmount, 24);
    expect(estimate.displayFare, '₹20.00–₹28.00');
  });
  test('FTL information cannot become a booking amount', () {
    final estimate = FareEstimateModel.fromJson({
      'estimateType': 'quote_required',
      'distanceMeters': 1000,
      'durationSeconds': 60,
      'bookable': false,
      'currency': 'INR',
      'pricing': {
        'baseFare': null,
        'perKmRate': {'minimum': 2600, 'maximum': 9100},
      },
      'message': availability,
    });
    expect(estimate.isUnavailable, isTrue);
    expect(estimate.bookingAmount, isNull);
    expect(estimate.pricingDescription, contains('₹26.00–₹91.00/km'));
  });
  test(
    'repository translates only missing-pricing error to availability',
    () async {
      final repository = RideRepositoryImpl(
        FailingDataSource('FARE_CONFIGURATION_MISSING'),
      );
      final estimate = await repository.estimateFare({});
      expect(estimate.message, availability);
      expect(estimate.bookable, isFalse);
      expect(estimate.isUnavailable, isTrue);
    },
  );
  test('repository retains API failures as errors', () async {
    final repository = RideRepositoryImpl(
      FailingDataSource('FARE_PRICING_INVALID'),
    );
    await expectLater(
      repository.estimateFare({}),
      throwsA(isA<ServerFailure>()),
    );
  });
  test(
    'atomic logistics selection makes one request and preserves range state',
    () async {
      final repository = RecordingRepository();
      final container = ProviderContainer(
        overrides: [rideRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      final notifier = container.read(rideProvider.notifier);
      notifier.setRoute(
        'Warehouse',
        'Customer',
        pickupCoords: const LatLng(12, 77),
        destCoords: const LatLng(13, 78),
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
        goods: {'weightKg': 30},
      );
      await Future<void>.delayed(Duration.zero);
      expect(repository.payloads.length, 1);
      expect(repository.payloads.single['vehicleCategory'], 'mini_truck');
      expect(container.read(rideProvider).fare, isNull);
      expect(container.read(rideProvider).fareEstimate!.isRange, isTrue);
    },
  );
  test('range-only booking never calls createRide', () async {
    final repository = RecordingRepository();
    final container = ProviderContainer(
      overrides: [rideRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    final notifier = container.read(rideProvider.notifier);
    notifier.setRoute(
      'A',
      'B',
      pickupCoords: const LatLng(12, 77),
      destCoords: const LatLng(13, 78),
      vehicleCategory: 'bike',
    );
    await Future<void>.delayed(Duration.zero);
    await notifier.requestRide();
    expect(repository.creates, 0);
    expect(container.read(rideProvider).errorMessage, contains('fixed quote'));
  });
  test('unsupported selection keeps vehicle and shows exact message', () async {
    final repository = RecordingRepository()
      ..estimate = FareEstimateModel.unavailable(availability);
    final container = ProviderContainer(
      overrides: [rideRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    final notifier = container.read(rideProvider.notifier);
    notifier.setRoute(
      'A',
      'B',
      pickupCoords: const LatLng(12, 77),
      destCoords: const LatLng(13, 78),
      vehicleCategory: 'unsupported',
    );
    await Future<void>.delayed(Duration.zero);
    expect(container.read(rideProvider).selectedTier, 'unsupported');
    expect(container.read(rideProvider).fareEstimate!.message, availability);
    expect(container.read(rideProvider).fare, isNull);
  });
  test('API failure is separate from unsupported state', () async {
    final repository = RecordingRepository()..error = NetworkFailure();
    final container = ProviderContainer(
      overrides: [rideRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    final notifier = container.read(rideProvider.notifier);
    notifier.setRoute(
      'A',
      'B',
      pickupCoords: const LatLng(12, 77),
      destCoords: const LatLng(13, 78),
      vehicleCategory: 'bike',
    );
    await Future<void>.delayed(Duration.zero);
    expect(container.read(rideProvider).fareEstimate, isNull);
    expect(container.read(rideProvider).errorMessage, contains('No internet'));
  });
  testWidgets('fare details render availability without fabricated amount', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FareRangeDetails(
            estimate: FareEstimateModel.unavailable(availability),
          ),
        ),
      ),
    );
    expect(find.text(availability), findsOneWidget);
    expect(find.textContaining('₹0'), findsNothing);
  });
  testWidgets('fare details show configured range information', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FareRangeDetails(estimate: FareEstimateModel.fromJson(range())),
        ),
      ),
    );
    expect(find.textContaining('₹5.00–₹8.00/km'), findsOneWidget);
    expect(find.textContaining('fixed quote'), findsOneWidget);
  });
}
