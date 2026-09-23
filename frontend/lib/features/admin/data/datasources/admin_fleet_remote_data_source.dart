import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/dio_client.dart';
import '../models/fleet_analytics_model.dart';

final adminFleetRemoteDataSourceProvider = Provider<AdminFleetRemoteDataSource>((ref) {
  return AdminFleetRemoteDataSource(ref.read(dioProvider));
});

class AdminFleetRemoteDataSource {
  final Dio _dio;

  AdminFleetRemoteDataSource(this._dio);

  Future<FleetAnalyticsSummaryModel> getFleetAnalyticsSummary({
    String? state,
    String? city,
    String? sector,
    String? category,
    String? status,
  }) async {
    final response = await _dio.get(
      '/admin/fleet/analytics',
      queryParameters: {
        if (state != null && state.isNotEmpty && state != 'All States') 'state': state,
        if (city != null && city.isNotEmpty && city != 'All Cities') 'city': city,
        if (sector != null && sector.isNotEmpty && sector != 'all') 'sector': sector,
        if (category != null && category.isNotEmpty && category != 'all') 'category': category,
        if (status != null && status.isNotEmpty && status != 'all') 'status': status,
      },
    );

    final data = response.data['data'] as Map<String, dynamic>;
    return FleetAnalyticsSummaryModel.fromJson(data);
  }

  Future<List<StateFleetAnalyticsModel>> getStateFleetAnalytics({
    String? sector,
  }) async {
    final response = await _dio.get(
      '/admin/fleet/states',
      queryParameters: {
        if (sector != null && sector.isNotEmpty && sector != 'all') 'sector': sector,
      },
    );

    final list = response.data['data'] as List<dynamic>? ?? [];
    return list.map((item) => StateFleetAnalyticsModel.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<CityFleetAnalyticsModel>> getCityFleetAnalytics(
    String state, {
    String? sector,
  }) async {
    final response = await _dio.get(
      '/admin/fleet/states/$state/cities',
      queryParameters: {
        if (sector != null && sector.isNotEmpty && sector != 'all') 'sector': sector,
      },
    );

    final list = response.data['data'] as List<dynamic>? ?? [];
    return list.map((item) => CityFleetAnalyticsModel.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<LiveFleetVehicleModel>> getLiveFleetVehicles({
    String? state,
    String? city,
    String? sector,
    String? category,
    String? status,
    String? search,
  }) async {
    final response = await _dio.get(
      '/admin/fleet/map',
      queryParameters: {
        if (state != null && state.isNotEmpty && state != 'All States') 'state': state,
        if (city != null && city.isNotEmpty && city != 'All Cities') 'city': city,
        if (sector != null && sector.isNotEmpty && sector != 'all') 'sector': sector,
        if (category != null && category.isNotEmpty && category != 'all') 'category': category,
        if (status != null && status.isNotEmpty && status != 'all') 'status': status,
        if (search != null && search.isNotEmpty) 'search': search,
      },
    );

    final items = response.data['data']?['items'] as List<dynamic>? ?? [];
    return items.map((item) => LiveFleetVehicleModel.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<LiveFleetVehicleModel?> getLiveFleetVehicleDetails(String id) async {
    final response = await _dio.get('/admin/fleet/vehicles/$id');
    final data = response.data['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return LiveFleetVehicleModel.fromJson(data);
  }
}
