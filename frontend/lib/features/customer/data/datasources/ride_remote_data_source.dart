import 'package:dio/dio.dart';
import '../models/fare_estimate_model.dart';
import '../models/fleet_vehicle_model.dart';
import '../models/ride_model.dart';

abstract class RideRemoteDataSource {
  Future<RideModel> createRide(Map<String, dynamic> data);
  Future<List<RideModel>> listRides({String? status, int? limit});
  Future<RideModel> getRide(String id);
  Future<RideModel> cancelRide(String id, String reason);
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data);
  Future<void> submitRating(String rideId, int rating, {String? review});
  Future<Map<String, dynamic>> initiatePayment(Map<String, dynamic> data);
  Future<Map<String, dynamic>> capturePayment(String paymentId, {String? providerPaymentId});
  Future<List<dynamic>> listPayments();
  Future<List<FleetVehicleModel>> getFleet({String? sector, String? category});
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

  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) async {
    final response = await _dio.post('/fares/estimate', data: data);
    return FareEstimateModel.fromJson(response.data['data']);
  }

  @override
  Future<void> submitRating(String rideId, int rating, {String? review}) async {
    await _dio.post('/ratings', data: {
      'rideId': rideId,
      'rating': rating,
      if (review != null && review.isNotEmpty) 'review': review,
    });
  }

  @override
  Future<Map<String, dynamic>> initiatePayment(Map<String, dynamic> data) async {
    final response = await _dio.post('/payments/initiate', data: data);
    return response.data['data'];
  }

  @override
  Future<Map<String, dynamic>> capturePayment(String paymentId, {String? providerPaymentId}) async {
    final response = await _dio.post(
      '/payments/$paymentId/capture',
      data: {
        if (providerPaymentId != null) 'providerPaymentId': providerPaymentId,
      },
    );
    return response.data['data'];
  }

  @override
  Future<List<dynamic>> listPayments() async {
    final response = await _dio.get('/payments/history');
    return response.data['data'] as List<dynamic>;
  }

  @override
  Future<List<FleetVehicleModel>> getFleet({String? sector, String? category}) async {
    final response = await _dio.get('/vehicles/fleet', queryParameters: {
      if (sector != null) 'sector': sector,
      if (category != null) 'category': category,
    });
    final List list = response.data['data'] as List;
    return list.map((e) => FleetVehicleModel.fromJson(e as Map<String, dynamic>)).toList();
  }
}
