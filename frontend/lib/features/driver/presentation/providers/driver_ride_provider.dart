import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/services/socket_service.dart';
import '../../../customer/data/models/ride_model.dart';
import '../../../customer/data/models/route_model.dart';
import 'driver_providers.dart';

class DriverRideState {
  final bool isLoading;
  final bool isAccepting;
  final bool isUpdatingStatus;
  final String? errorMessage;
  final RideModel? currentRide;
  final RouteModel? currentRoute;

  DriverRideState({
    this.isLoading = false,
    this.isAccepting = false,
    this.isUpdatingStatus = false,
    this.errorMessage,
    this.currentRide,
    this.currentRoute,
  });

  DriverRideState copyWith({
    bool? isLoading,
    bool? isAccepting,
    bool? isUpdatingStatus,
    String? errorMessage,
    RideModel? currentRide,
    RouteModel? currentRoute,
  }) {
    return DriverRideState(
      isLoading: isLoading ?? this.isLoading,
      isAccepting: isAccepting ?? this.isAccepting,
      isUpdatingStatus: isUpdatingStatus ?? this.isUpdatingStatus,
      errorMessage: errorMessage,
      currentRide: currentRide ?? this.currentRide,
      currentRoute: currentRoute ?? this.currentRoute,
    );
  }
}

class DriverRideNotifier extends StateNotifier<DriverRideState> {
  final Ref ref;
  StreamSubscription<SocketServerEvent>? _eventSubscription;
  Timer? _locationTimer;

  DriverRideNotifier(this.ref) : super(DriverRideState()) {
    _subscribeToSocketEvents();
  }

  void _subscribeToSocketEvents() {
    _eventSubscription?.cancel();
    _eventSubscription = ref.read(socketServiceProvider).eventStream.listen((event) {
      _handleSocketEvent(event);
    });
  }

  void _handleSocketEvent(SocketServerEvent event) {
    if (state.currentRide == null) return;

    switch (event.name) {
      case 'ride:lifecycle_updated':
        final rideData = event.data['ride'];
        if (rideData != null) {
          final updated = RideModel.fromJson(rideData as Map<String, dynamic>);
          if (updated.id == state.currentRide?.id) {
            state = state.copyWith(currentRide: updated);
            _handleRideStateChange(updated.status);
          }
        }
        break;

      case 'ride:route_updated':
        final rideId = event.data['rideId'];
        if (rideId == state.currentRide?.id) {
          final routeData = event.data['route'];
          if (routeData != null) {
            state = state.copyWith(
              currentRoute: RouteModel.fromJson(routeData as Map<String, dynamic>),
            );
          }
        }
        break;
    }
  }

  Future<void> acceptRide(String rideId) async {
    state = state.copyWith(isAccepting: true, errorMessage: null);

    try {
      final ride = await ref.read(acceptRideUseCaseProvider).execute(rideId);
      
      state = state.copyWith(
        isAccepting: false,
        currentRide: ride,
      );

      // Join socket room for this ride
      ref.read(socketServiceProvider).joinRide(rideId);
      _startLocationBroadcasting(rideId);
    } catch (e) {
      state = state.copyWith(
        isAccepting: false,
        errorMessage: e.toString(),
      );
    }
  }

  Future<void> transitionStatus(String rideId, String newStatus) async {
    state = state.copyWith(isUpdatingStatus: true, errorMessage: null);

    try {
      final ride = await ref.read(updateRideStatusUseCaseProvider).execute(rideId, newStatus);

      state = state.copyWith(
        isUpdatingStatus: false,
        currentRide: ride,
      );

      _handleRideStateChange(ride.status);
    } catch (e) {
      state = state.copyWith(
        isUpdatingStatus: false,
        errorMessage: e.toString(),
      );
    }
  }

  Future<void> completeRide(String rideId) async {
    state = state.copyWith(isUpdatingStatus: true, errorMessage: null);

    try {
      final ride = await ref.read(completeRideUseCaseProvider).execute(rideId);

      state = state.copyWith(
        isUpdatingStatus: false,
        currentRide: ride,
      );

      _handleRideStateChange(RideStatus.completed);
    } catch (e) {
      state = state.copyWith(
        isUpdatingStatus: false,
        errorMessage: e.toString(),
      );
    }
  }

  void _startLocationBroadcasting(String rideId) {
    _locationTimer?.cancel();
    // 15s interval keeps driver location fresh (< 30s backend stale threshold)
    _locationTimer = Timer.periodic(const Duration(seconds: 15), (_) async {
      if (state.currentRide == null ||
          state.currentRide?.status == RideStatus.completed ||
          state.currentRide?.status == RideStatus.cancelled) {
        _stopLocationBroadcasting();
        return;
      }

      final position = await ref.read(locationServiceProvider).getCurrentPosition();
      if (position != null) {
        final now = DateTime.now();
        ref.read(socketServiceProvider).updateDriverLocation(
              rideId: rideId,
              latitude: position.latitude,
              longitude: position.longitude,
              timestamp: now,
            );
      }
    });
  }

  void _stopLocationBroadcasting() {
    _locationTimer?.cancel();
    _locationTimer = null;
  }

  void _handleRideStateChange(RideStatus status) {
    if (status == RideStatus.completed || status == RideStatus.cancelled) {
      if (state.currentRide?.id != null) {
        ref.read(socketServiceProvider).leaveRide(state.currentRide!.id);
      }
      _stopLocationBroadcasting();
    }
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    _stopLocationBroadcasting();
    super.dispose();
  }
}

final driverRideProvider =
    StateNotifierProvider<DriverRideNotifier, DriverRideState>((ref) {
  return DriverRideNotifier(ref);
});
