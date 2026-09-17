import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/partner_model.dart';
import '../../data/models/vehicle_model.dart';
import 'driver_providers.dart';

class DriverDashboardState {
  final bool isLoading;
  final String? errorMessage;
  final PartnerModel? partner;
  final VehicleModel? vehicle;
  final bool isUpdatingAvailability;

  DriverDashboardState({
    this.isLoading = false,
    this.errorMessage,
    this.partner,
    this.vehicle,
    this.isUpdatingAvailability = false,
  });

  DriverDashboardState copyWith({
    bool? isLoading,
    String? errorMessage,
    PartnerModel? partner,
    VehicleModel? vehicle,
    bool? isUpdatingAvailability,
  }) {
    return DriverDashboardState(
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
      partner: partner ?? this.partner,
      vehicle: vehicle ?? this.vehicle,
      isUpdatingAvailability: isUpdatingAvailability ?? this.isUpdatingAvailability,
    );
  }
}

class DriverDashboardNotifier extends StateNotifier<DriverDashboardState> {
  final Ref ref;

  DriverDashboardNotifier(this.ref) : super(DriverDashboardState());

  Future<void> loadDashboard() async {
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      final storage = ref.read(secureStorageProvider);
      final partnerId = await storage.read(key: 'partner_id');

      if (partnerId == null || partnerId.isEmpty) {
        state = state.copyWith(isLoading: false, partner: null, vehicle: null);
        return;
      }

      final partner = await ref.read(getPartnerUseCaseProvider).execute(partnerId);

      VehicleModel? vehicle;
      try {
        final vehicles = await ref.read(listVehiclesUseCaseProvider).execute(partnerId);
        if (vehicles.isNotEmpty) {
          vehicle = vehicles.firstWhere((v) => v.isActive, orElse: () => vehicles.first);
        }
      } catch (_) {
        // Vehicle fetch failure does not block partner profile display
      }

      state = state.copyWith(
        isLoading: false,
        partner: partner,
        vehicle: vehicle,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: e.toString(),
      );
    }
  }

  Future<void> updateAvailability(String newStatus) async {
    if (state.partner == null || state.isUpdatingAvailability) return;

    state = state.copyWith(isUpdatingAvailability: true, errorMessage: null);

    try {
      await ref.read(updateDriverAvailabilityUseCaseProvider).execute(newStatus);

      final updatedPartner = PartnerModel(
        id: state.partner!.id,
        userId: state.partner!.userId,
        businessName: state.partner!.businessName,
        businessDescription: state.partner!.businessDescription,
        approvalStatus: state.partner!.approvalStatus,
        availabilityStatus: newStatus,
        createdAt: state.partner!.createdAt,
        updatedAt: DateTime.now(),
      );

      state = state.copyWith(
        isUpdatingAvailability: false,
        partner: updatedPartner,
      );
    } catch (e) {
      state = state.copyWith(
        isUpdatingAvailability: false,
        errorMessage: e.toString(),
      );
    }
  }
}

final driverDashboardProvider =
    StateNotifierProvider<DriverDashboardNotifier, DriverDashboardState>((ref) {
  return DriverDashboardNotifier(ref);
});
