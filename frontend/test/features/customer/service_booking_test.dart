import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/data/datasources/ride_remote_data_source.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';

import 'vehicle_fare_ranges_test.dart'
    show RecordingRepository, ConnectedSocket;

Map<String, dynamic> serviceQuote({bool available = true}) {
  final fare = {
    'grossAmount': 12345,
    'baseAmount': 12345,
    'distanceAmount': 0,
    'timeAmount': 0,
    'distanceMeters': 0,
    'durationSeconds': 0,
    'currency': 'INR',
    'pricingVersion': 'vehicle-type:service:v2',
    'vehicleConfiguration': {'id': 'service', 'pricingModel': 'service_fixed'},
  };
  return {
    'estimateType': 'range',
    'bookable': available,
    'available': available,
    'message': available
        ? 'Fixed service fare'
        : 'No eligible service vehicle within the configured radius.',
    'currency': 'INR',
    'vehicleCategory': 'ambulance',
    'pricingVersion': 'vehicle-type:service:v2',
    'distanceMeters': 0,
    'durationSeconds': 0,
    'pricing': {
      'baseFare': {'minimum': 12345, 'maximum': 12345},
      'perKmRate': {'minimum': 0, 'maximum': 0},
    },
    'estimatedFare': {'minimum': fare, 'maximum': fare},
    'bookingFare': fare,
  };
}

class LostServiceResponse extends RecordingRepository {
  final requests = <Map<String, dynamic>>[];
  @override
  Future<RideModel> createRide(Map<String, dynamic> data) async {
    requests.add(Map<String, dynamic>.from(data));
    throw DioException(
      requestOptions: RequestOptions(path: '/rides'),
      type: DioExceptionType.connectionError,
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('Service catalog and availability use the configured backend APIs and fixed price', () async {
    final paths = <String>[];
    final dio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (request, handler) {
            paths.add(request.path);
            handler.resolve(
              Response(
                requestOptions: request,
                statusCode: 200,
                data: {
                  'data': request.path == '/vehicles/catalog'
                      ? [
                          {
                            'id': 'service',
                            'name': 'Ambulance',
                            'code': 'ambulance',
                            'sector': 'service',
                            'serviceFixedFare': 123.45,
                            'serviceRadiusMeters': 25000,
                          },
                        ]
                      : serviceQuote(),
                },
              ),
            );
          },
        ),
      );
    final source = RideRemoteDataSourceImpl(dio);
    final types = await source.getFleet(sector: 'service');
    expect(types.single.category, 'ambulance');
    expect(types.single.pricing, 123.45);
    expect(types.single.range, contains('25'));
    final quote = await source.estimateFare({'sector': 'service'});
    expect(paths, ['/vehicles/catalog', '/rides/service-availability']);
    expect(quote.bookingAmount, 123.45);
    expect(quote.displayFare, '₹123.45');
    expect(quote.pricingDescription, contains('Fixed service fare'));
    expect(quote.pricingQuote?['amountPaise'], 12345);
  });
  test('unavailable Service keeps its displayed fixed fare but cannot be confirmed', () {
    final quote = FareEstimateModel.fromJson(serviceQuote(available: false));
    expect(quote.displayFare, '₹123.45');
    expect(quote.bookingAmount, isNull);
    expect(quote.pricingQuote, isNull);
    expect(quote.message, contains('No eligible'));
  });
  test('lost response, retry and app recreation reuse the durable request ID; new intent changes it', () async {
    FlutterSecureStorage.setMockInitialValues({'user_id': 'service-customer'});
    final repo = LostServiceResponse()
      ..estimate = FareEstimateModel.fromJson(serviceQuote());
    Future<void> attempt(double longitude, {int repeats = 1}) async {
      final socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(repo),
          socketServiceProvider.overrideWithValue(socket),
        ],
      );
      try {
        final notifier = container.read(rideProvider.notifier);
        notifier.selectSector('service');
        notifier.setRoute(
          'Pickup',
          'Destination',
          pickupCoords: const LatLng(25.6, 85.1),
          destCoords: LatLng(25.61, longitude),
          vehicleCategory: 'ambulance',
        );
        await notifier.estimateRouteFare();
        for (var i = 0; i < repeats; i++) await notifier.requestRide();
      } finally {
        container.dispose();
        socket.dispose();
      }
    }

    await attempt(85.2, repeats: 2);
    await attempt(85.2);
    await attempt(85.3);
    expect(repo.requests, hasLength(4));
    final id = repo.requests.first['clientRequestId'];
    expect(
      id,
      matches(
        RegExp(
          r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$',
        ),
      ),
    );
    expect(repo.requests[1]['clientRequestId'], id);
    expect(repo.requests[2]['clientRequestId'], id);
    expect(repo.requests[3]['clientRequestId'], isNot(id));
    expect(repo.requests.first['sector'], 'service');
    expect(repo.requests.first['vehicleCategory'], 'ambulance');
    expect((repo.requests.first['pricingQuote'] as Map)['amountPaise'], 12345);
  });
}
