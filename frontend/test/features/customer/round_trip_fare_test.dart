import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';

void main() {
  final response = <String, dynamic>{
    'currency': 'INR',
    'grossAmount': 12500,
    'baseAmount': 2500,
    'distanceAmount': 10000,
    'timeAmount': 0,
    'distanceMeters': 10000,
    'billableDistanceMeters': 20000,
    'durationSeconds': 600,
  };
  test(
    'uses backend route and billable distances without recalculating price',
    () {
      final fare = FareEstimateModel.fromJson(response);
      expect(fare.distanceKm, 10);
      expect(fare.billableDistanceKm, 20);
      expect(fare.distanceAmount, 100);
      expect(fare.bookingAmount, 125);
      expect(FareEstimateModel.fromJson(response).bookingAmount, 125);
    },
  );
  test('rejects invalid billable distance and preserves legacy responses', () {
    expect(
      () => FareEstimateModel.fromJson({
        ...response,
        'billableDistanceMeters': -1,
      }),
      throwsFormatException,
    );
    final legacy = {...response}..remove('billableDistanceMeters');
    expect(FareEstimateModel.fromJson(legacy).billableDistanceKm, isNull);
  });
}
