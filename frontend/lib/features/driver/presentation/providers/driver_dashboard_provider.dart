import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/driver_history_model.dart';
import '../../data/models/partner_model.dart';
import '../../data/models/vehicle_model.dart';
import 'driver_providers.dart';

class DriverDashboardState {
  final bool isLoading;
  final String? errorMessage;
  final PartnerModel? partner;
  final VehicleModel? vehicle;
  final DriverHistoryModel? history;
  final bool isUpdatingAvailability;
  final bool isBroadcastingLocation;

  DriverDashboardState({
    this.isLoading = false,
    this.errorMessage,
    this.partner,
    this.vehicle,
    this.history,
    this.isUpdatingAvailability = false,
    this.isBroadcastingLocation = false,
  });

  DriverDashboardState copyWith({
    bool? isLoading,
    String? errorMessage,
    PartnerModel? partner,
    VehicleModel? vehicle,
    DriverHistoryModel? history,
    bool? isUpdatingAvailability,
    bool? isBroadcastingLocation,
  }) {
    return DriverDashboardState(
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
      partner: partner ?? this.partner,
      vehicle: vehicle ?? this.vehicle,
      history: history ?? this.history,
      isUpdatingAvailability: isUpdatingAvailability ?? this.isUpdatingAvailability,
      isBroadcastingLocation: isBroadcastingLocation ?? this.isBroadcastingLocation,
    );
  }
}

class DriverDashboardNotifier extends StateNotifier<DriverDashboardState> {
  final Ref ref;
  Timer? _locationTimer;

  DriverDashboardNotifier(this.ref) : super(DriverDashboardState());

  @override
  void dispose() {
    _stopLocationBroadcasting();
    super.dispose();
  }

  Future<void> loadDashboard() async {
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      PartnerModel? partner;
      // 1. Try to load partner using getMyPartner endpoint
      try {
        partner = await ref.read(getMyPartnerUseCaseProvider).execute();
        if (partner != null) {
          await ref.read(secureStorageProvider).write(key: 'partner_id', value: partner.id);
        }
      } catch (_) {
        // Fallback to reading partner_id from secure storage
        final storage = ref.read(secureStorageProvider);
        final partnerId = await storage.read(key: 'partner_id');
        if (partnerId != null && partnerId.isNotEmpty) {
          try {
            partner = await ref.read(getPartnerUseCaseProvider).execute(partnerId);
          } catch (_) {}
        }
      }

      if (partner == null) {
        state = state.copyWith(isLoading: false, partner: null, vehicle: null, history: null);
        _stopLocationBroadcasting();
        return;
      }

      // 2. Fetch active vehicle if available
      VehicleModel? vehicle;
      try {
        final vehicles = await ref.read(listVehiclesUseCaseProvider).execute(partner.id);
        if (vehicles.isNotEmpty) {
          vehicle = vehicles.firstWhere((v) => v.isActive, orElse: () => vehicles.first);
        }
      } catch (_) {}

      // 3. Fetch driver ride & earnings history
      DriverHistoryModel? history;
      try {
        history = await ref.read(getDriverHistoryUseCaseProvider).execute();
      } catch (_) {}

      state = state.copyWith(
        isLoading: false,
        partner: partner,
        vehicle: vehicle,
        history: history,
      );

      // 4. If driver is already online, ensure GPS location broadcast is active
      if (partner.availabilityStatus == 'available') {
        _startLocationBroadcasting();
      } else {
        _stopLocationBroadcasting();
      }
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

      if (newStatus == 'available') {
        _startLocationBroadcasting();
      } else {
        _stopLocationBroadcasting();
      }
    } catch (e) {
      state = state.copyWith(
        isUpdatingAvailability: false,
        errorMessage: e.toString(),
      );
    }
  }

  void _startLocationBroadcasting() {
    if (_locationTimer != null && _locationTimer!.isActive) return;

    state = state.copyWith(isBroadcastingLocation: true);

    // Broadcast immediately on going online
    _broadcastCurrentLocation();

    // Broadcast periodically every 20 seconds while online
    _locationTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      _broadcastCurrentLocation();
    });
  }

  void _stopLocationBroadcasting() {
    _locationTimer?.cancel();
    _locationTimer = null;
    if (state.isBroadcastingLocation) {
      state = state.copyWith(isBroadcastingLocation: false);
    }
  }

  Future<void> _broadcastCurrentLocation() async {
    // Strict requirement: Never broadcast GPS if driver is offline
    if (state.partner?.availabilityStatus != 'available') {
      _stopLocationBroadcasting();
      return;
    }

    try {
      final position = await ref.read(locationServiceProvider).getCurrentPosition();
      if (position != null) {
        await ref.read(updateDriverLocationUseCaseProvider).execute({
          'latitude': position.latitude,
          'longitude': position.longitude,
          'timestamp': DateTime.now().toIso8601String(),
        });
      }
    } catch (_) {
      // Background location broadcast failures are logged/ignored gracefully
    }
  }
}

final driverDashboardProvider =
    StateNotifierProvider<DriverDashboardNotifier, DriverDashboardState>((ref) {
  return DriverDashboardNotifier(ref);
});
