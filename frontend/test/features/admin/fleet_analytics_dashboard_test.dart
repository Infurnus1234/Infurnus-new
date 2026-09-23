import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/admin/data/datasources/admin_fleet_remote_data_source.dart';
import 'package:infurnus/features/admin/data/models/fleet_analytics_model.dart';
import 'package:infurnus/features/admin/presentation/screens/fleet_analytics_dashboard_screen.dart';

class FakeAdminFleetRemoteDataSource implements AdminFleetRemoteDataSource {
  @override
  Future<FleetAnalyticsSummaryModel> getFleetAnalyticsSummary({
    String? state,
    String? city,
    String? sector,
    String? category,
    String? status,
  }) async {
    return const FleetAnalyticsSummaryModel(
      totalVehicles: 10,
      activeVehicles: 6,
      onTripVehicles: 2,
      offlineVehicles: 2,
      activePercentage: 60.0,
    );
  }

  @override
  Future<List<StateFleetAnalyticsModel>> getStateFleetAnalytics({String? sector}) async {
    return [
      const StateFleetAnalyticsModel(
        state: 'Bihar',
        total: 10,
        active: 6,
        onTrip: 2,
        offline: 2,
      ),
    ];
  }

  @override
  Future<List<CityFleetAnalyticsModel>> getCityFleetAnalytics(String state, {String? sector}) async {
    return [
      const CityFleetAnalyticsModel(
        state: 'Bihar',
        city: 'Patna',
        total: 10,
        active: 6,
        onTrip: 2,
        offline: 2,
      ),
    ];
  }

  @override
  Future<List<LiveFleetVehicleModel>> getLiveFleetVehicles({
    String? state,
    String? city,
    String? sector,
    String? category,
    String? status,
    String? search,
  }) async {
    return [];
  }

  @override
  Future<LiveFleetVehicleModel?> getLiveFleetVehicleDetails(String id) async {
    return null;
  }
}

void main() {
  testWidgets('FleetAnalyticsDashboardScreen renders header and title', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminFleetRemoteDataSourceProvider.overrideWithValue(FakeAdminFleetRemoteDataSource()),
        ],
        child: const MaterialApp(
          home: FleetAnalyticsDashboardScreen(),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Fleet Management'), findsOneWidget);
    expect(
      find.text('Monitor your vehicles, drivers and operations in real time.'),
      findsOneWidget,
    );
  });

  test('FleetAnalyticsSummaryModel parses correctly from json', () {
    final json = {
      'totalVehicles': 100,
      'activeVehicles': 60,
      'onTripVehicles': 25,
      'offlineVehicles': 15,
      'activePercentage': 60.0,
    };

    final model = FleetAnalyticsSummaryModel.fromJson(json);

    expect(model.totalVehicles, 100);
    expect(model.activeVehicles, 60);
    expect(model.onTripVehicles, 25);
    expect(model.offlineVehicles, 15);
    expect(model.activePercentage, 60.0);
  });

  test('StateFleetAnalyticsModel parses correctly from json', () {
    final json = {
      'state': 'Bihar',
      'total': 420,
      'active': 280,
      'onTrip': 95,
      'offline': 45,
    };

    final model = StateFleetAnalyticsModel.fromJson(json);

    expect(model.state, 'Bihar');
    expect(model.total, 420);
    expect(model.active, 280);
    expect(model.onTrip, 95);
    expect(model.offline, 45);
  });
}
