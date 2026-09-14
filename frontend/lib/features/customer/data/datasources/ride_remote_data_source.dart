import 'package:dio/dio.dart';
import '../models/ride_model.dart';

abstract class RideRemoteDataSource {
  Future<RideModel> createRide(Map<String, dynamic> data);
  Future<List<RideModel>> listRides({String? status, int? limit});
  Future<RideModel> getRide(String id);
  Future<RideModel> cancelRide(String id, String reason);
}

class RideRemoteDataSourceImpl implements RideRemoteDataSource {
  final Dio _dio;
  RideRemoteDataSourceImpl(this._dio);

  @override
  Future<RideModel> createRide(Map<String, dynamic> data) async {
    final response = await _dio.post('/rides', data: data);
    return RideModel.fromJson(response.data['data']);
  }

  @override
  Future<List<RideModel>> listRides({String? status, int? limit}) async {
    final response = await _dio.get('/rides', queryParameters: {
      if (status != null) 'status': status,
      if (limit != null) 'limit': limit,
    });
    final List list = response.data['data'];
    return list.map((e) => RideModel.fromJson(e)).toList();
  }

  @override
  Future<RideModel> getRide(String id) async {
    final response = await _dio.get('/rides/$id');
    return RideModel.fromJson(response.data['data']);
  }

  @override
  Future<RideModel> cancelRide(String id, String reason) async {
    final response = await _dio.post('/rides/$id/cancel', data: {'reason': reason});
    return RideModel.fromJson(response.data['data']);
  }
}
