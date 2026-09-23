import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/datasources/admin_fleet_remote_data_source.dart';
import '../../data/models/fleet_analytics_model.dart';

class AdminFleetState {
  final FleetAnalyticsSummaryModel? summary;
  final List<StateFleetAnalyticsModel> states;
  final List<CityFleetAnalyticsModel> cities;
  final List<LiveFleetVehicleModel> vehicles;
  final LiveFleetVehicleModel? selectedVehicle;
  final String? selectedState;
  final String? selectedCity;
  final String selectedSector;
  final String selectedStatus;
  final String searchQuery;
  final bool isLoading;
  final String? errorMessage;

  const AdminFleetState({
    this.summary,
    this.states = const [],
    this.cities = const [],
    this.vehicles = const [],
    this.selectedVehicle,
    this.selectedState,
    this.selectedCity,
    this.selectedSector = 'all',
    this.selectedStatus = 'all',
    this.searchQuery = '',
    this.isLoading = false,
    this.errorMessage,
  });

  AdminFleetState copyWith({
    FleetAnalyticsSummaryModel? summary,
    List<StateFleetAnalyticsModel>? states,
    List<CityFleetAnalyticsModel>? cities,
    List<LiveFleetVehicleModel>? vehicles,
    LiveFleetVehicleModel? selectedVehicle,
    bool clearSelectedVehicle = false,
    String? selectedState,
    bool clearSelectedState = false,
    String? selectedCity,
    bool clearSelectedCity = false,
    String? selectedSector,
    String? selectedStatus,
    String? searchQuery,
    bool? isLoading,
    String? errorMessage,
    bool clearError = false,
  }) {
    return AdminFleetState(
      summary: summary ?? this.summary,
      states: states ?? this.states,
      cities: cities ?? this.cities,
      vehicles: vehicles ?? this.vehicles,
      selectedVehicle: clearSelectedVehicle ? null : (selectedVehicle ?? this.selectedVehicle),
      selectedState: clearSelectedState ? null : (selectedState ?? this.selectedState),
      selectedCity: clearSelectedCity ? null : (selectedCity ?? this.selectedCity),
      selectedSector: selectedSector ?? this.selectedSector,
      selectedStatus: selectedStatus ?? this.selectedStatus,
      searchQuery: searchQuery ?? this.searchQuery,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

final adminFleetNotifierProvider = StateNotifierProvider<AdminFleetNotifier, AdminFleetState>((ref) {
  return AdminFleetNotifier(ref.read(adminFleetRemoteDataSourceProvider));
});

class AdminFleetNotifier extends StateNotifier<AdminFleetState> {
  final AdminFleetRemoteDataSource _dataSource;

  AdminFleetNotifier(this._dataSource) : super(const AdminFleetState()) {
    loadDashboardData();
  }

  Future<void> loadDashboardData() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final summary = await _dataSource.getFleetAnalyticsSummary(
        state: state.selectedState,
        city: state.selectedCity,
        sector: state.selectedSector,
        status: state.selectedStatus,
      );

      final statesList = await _dataSource.getStateFleetAnalytics(
        sector: state.selectedSector,
      );

      List<CityFleetAnalyticsModel> citiesList = [];
      if (state.selectedState != null && state.selectedState!.isNotEmpty) {
        citiesList = await _dataSource.getCityFleetAnalytics(
          state.selectedState!,
          sector: state.selectedSector,
        );
      }

      final vehiclesList = await _dataSource.getLiveFleetVehicles(
        state: state.selectedState,
        city: state.selectedCity,
        sector: state.selectedSector,
        status: state.selectedStatus,
        search: state.searchQuery,
      );

      state = state.copyWith(
        summary: summary,
        states: statesList,
        cities: citiesList,
        vehicles: vehiclesList,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Unable to load fleet data. Please try again.',
      );
    }
  }

  void setSelectedState(String? newState) {
    if (newState == state.selectedState) return;
    if (newState == null || newState == 'All States') {
      state = state.copyWith(
        clearSelectedState: true,
        clearSelectedCity: true,
        cities: [],
      );
    } else {
      state = state.copyWith(
        selectedState: newState,
        clearSelectedCity: true,
      );
    }
    loadDashboardData();
  }

  void setSelectedCity(String? newCity) {
    if (newCity == state.selectedCity) return;
    if (newCity == null || newCity == 'All Cities') {
      state = state.copyWith(clearSelectedCity: true);
    } else {
      state = state.copyWith(selectedCity: newCity);
    }
    loadDashboardData();
  }

  void setSelectedSector(String sector) {
    if (sector == state.selectedSector) return;
    state = state.copyWith(selectedSector: sector);
    loadDashboardData();
  }

  void setSelectedStatus(String status) {
    if (status == state.selectedStatus) return;
    state = state.copyWith(selectedStatus: status);
    loadDashboardData();
  }

  void setSearchQuery(String query) {
    state = state.copyWith(searchQuery: query);
    loadDashboardData();
  }

  void selectVehicle(LiveFleetVehicleModel? vehicle) {
    state = state.copyWith(
      selectedVehicle: vehicle,
      clearSelectedVehicle: vehicle == null,
    );
  }
}
