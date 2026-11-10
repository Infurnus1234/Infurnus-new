import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/errors/failures.dart';
import 'package:infurnus/features/customer/data/datasources/ride_remote_data_source.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/data/repositories/ride_repository_impl.dart';

class UnavailableSource implements RideRemoteDataSource {
  @override
  Future<RideModel> createRide(Map<String, dynamic> data) async {
    final request = RequestOptions(path: '/rides');
    throw DioException.badResponse(
      statusCode: 409,
      requestOptions: request,
      response: Response(
        requestOptions: request,
        statusCode: 409,
        data: {
          'success': false,
          'error': {
            'code': 'NO_ELIGIBLE_DRIVERS',
            'message': 'No eligible drivers are available for this vehicle near your pickup. Please try again later.',
          },
        },
      ),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('unavailable supply preserves the actionable backend message instead of Dio internals', () async {
    await expectLater(
      RideRepositoryImpl(UnavailableSource()).createRide({}),
      throwsA(
        isA<ServerFailure>().having(
          (e) => e.message,
          'message',
          'No eligible drivers are available for this vehicle near your pickup. Please try again later.',
        ),
      ),
    );
  });
}
