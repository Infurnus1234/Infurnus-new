import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';

class RealPricingHttp extends HttpOverrides {}

void main() {
  test(
    'real Admin save reaches Customer fare display and persistent booking',
    () async {
      final fixture = jsonDecode(
        File('../tmp/strict-pricing-client.json').readAsStringSync(),
      ) as Map;
      final url = Uri.parse(fixture['url'] as String);
      if (url.host != '127.0.0.1' || url.port != 3146) {
        throw StateError('Local pricing test server required');
      }
      final dio = Dio(
        BaseOptions(
          baseUrl: url.toString(),
          headers: {'Authorization': 'Bearer ${fixture['token']}'},
        ),
      );
      dio.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () => RealPricingHttp().createHttpClient(null),
      );
      addTearDown(() => dio.close(force: true));
      final input = {
        'pickup': {'latitude': 25.6, 'longitude': 85.1},
        'destination': {'latitude': 25.61, 'longitude': 85.11},
        'sector': 'service',
        'vehicleCategory': 'ambulance',
      };
      final response = await dio.post('/fares/estimate', data: input);
      final fare = FareEstimateModel.fromJson(response.data['data']);
      expect(fare.vehicleCategory, 'ambulance');
      expect(fare.displayFare, '₹363.00');
      expect(fare.bookingAmount, 363);
      expect(fare.pricingQuote, isNotNull);
      final booked = await dio.post(
        '/rides',
        data: {...input, 'pricingQuote': fare.pricingQuote},
      );
      expect(booked.statusCode, 201);
      expect(booked.data['data']['fareEstimate'], 363);
      expect(booked.data['data']['vehicleCategory'], 'ambulance');
      final saved = await dio.get('/rides/${booked.data['data']['id']}');
      expect(saved.data['data']['fareEstimate'], 363);
      expect(saved.data['data']['bookingPricingVersion'], fare.pricingVersion);
      try {
        await dio.post(
          '/fares/estimate',
          data: {...input, 'vehicleCategory': 'crane'},
        );
        fail('Unpriced Crane must fail');
      } on DioException catch (e) {
        expect(e.response?.statusCode, 422);
        expect(e.response?.data['error']['code'], 'FARE_CONFIGURATION_MISSING');
      }
      final unavailable = FareEstimateModel.unavailable(
        'Vehicle is not available for booking yet.',
      );
      expect(unavailable.displayFare, 'Available Soon');
      expect(unavailable.bookingAmount, isNull);
    },
    skip: !const bool.fromEnvironment('STRICT_PRICING_LIVE'),
  );
}
