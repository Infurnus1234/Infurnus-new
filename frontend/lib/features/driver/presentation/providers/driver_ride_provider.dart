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
  final bool isLoadingAvailable;
  final String? errorMessage;
  final RideModel? currentRide;
  final RouteModel? currentRoute;
  final List<RideModel> availableRides;

  DriverRideState({
    this.isLoading = false,
    this.isAccepting = false,
    this.isUpdatingStatus = false,
    this.isLoadingAvailable = false,
    this.errorMessage,
    this.currentRide,
    this.currentRoute,
    this.availableRides = const [],
  });

  DriverRideState copyWith({
    bool? isLoading,
    bool? isAccepting,
    bool? isUpdatingStatus,
    bool? isLoadingAvailable,
    String? errorMessage,
    RideModel? currentRide,
    RouteModel? currentRoute,
    List<RideModel>? availableRides,
  }) {
    return DriverRideState(
      isLoading: isLoading ?? this.isLoading,
      isAccepting: isAccepting ?? this.isAccepting,
      isUpdatingStatus: isUpdatingStatus ?? this.isUpdatingStatus,
      isLoadingAvailable: isLoadingAvailable ?? this.isLoadingAvailable,
      errorMessage: errorMessage,
      currentRide: currentRide ?? this.currentRide,
      currentRoute: currentRoute ?? this.currentRoute,
      availableRides: availableRides ?? this.availableRides,
    );
  }
}

class DriverRideNotifier extends StateNotifier<DriverRideState> {
  final Ref ref;
  StreamSubscription<SocketServerEvent>? _eventSubscription;
  Timer? _locationTimer;

  DriverRideNotifier(this.ref) : super(DriverRideState()) {
    _subscribeToSocketEvents();
    fetchAvailableRides();
  }

  void _subscribeToSocketEvents() {
    _eventSubscription?.cancel();
    _eventSubscription = ref.read(socketServiceProvider).eventStream.listen((event) {
      _handleSocketEvent(event);
    });
  }

  void _handleSocketEvent(SocketServerEvent event) {
    switch (event.name) {
      case 'ride:incoming':
        final rideData = event.data is Map ? event.data['ride'] ?? event.data : null;
        if (rideData != null && rideData is Map<String, dynamic>) {
          try {
            final newRide = RideModel.fromJson(rideData);
            final currentList = List<RideModel>.from(state.availableRides);
            currentList.removeWhere((r) => r.id == newRide.id);
            currentList.insert(0, newRide);
            state = state.copyWith(availableRides: currentList);
          } catch (_) {}
        }
        break;

      case 'ride:taken':
      case 'ride:cancelled':
        final rideId = event.data is Map ? (event.data['rideId'] ?? event.data['id']) : null;
        if (rideId != null) {
          final currentList = List<RideModel>.from(state.availableRides);
          currentList.removeWhere((r) => r.id == rideId.toString());
          state = state.copyWith(availableRides: currentList);
        }
        break;

      case 'ride:lifecycle_updated':
        if (state.currentRide == null) return;
        final rideData = event.data is Map ? event.data['ride'] : null;
        if (rideData != null && rideData is Map<String, dynamic>) {
          final updated = RideModel.fromJson(rideData);
          if (updated.id == state.currentRide?.id) {
            state = state.copyWith(currentRide: updated);
            _handleRideStateChange(updated.status);
          }
        }
        break;

      case 'ride:route_updated':
        if (state.currentRide == null) return;
        final rideId = event.data is Map ? event.data['rideId'] : null;
        if (rideId == state.currentRide?.id) {
          final routeData = event.data['route'];
          if (routeData != null && routeData is Map<String, dynamic>) {
            state = state.copyWith(
              currentRoute: RouteModel.fromJson(routeData),
            );
          }
        }
        break;
    }
  }

  Future<void> fetchAvailableRides() async {
    state = state.copyWith(isLoadingAvailable: true, errorMessage: null);
    try {
      final rides = await ref.read(getAvailableRidesUseCaseProvider).execute();
      state = state.copyWith(availableRides: rides, isLoadingAvailable: false);
    } catch (e) {
      state = state.copyWith(isLoadingAvailable: false, errorMessage: e.toString());
    }
  }

  void dismissRide(String rideId) {
    final currentList = List<RideModel>.from(state.availableRides);
    currentList.removeWhere((r) => r.id == rideId);
    state = state.copyWith(availableRides: currentList);
  }

  Future<void> acceptRide(String rideId) async {
    state = state.copyWith(isAccepting: true, errorMessage: null);

    try {
      final ride = await ref.read(acceptRideUseCaseProvider).execute(rideId);
      
      final currentList = List<RideModel>.from(state.availableRides);
      currentList.removeWhere((r) => r.id == rideId);

      state = state.copyWith(
        isAccepting: false,
        currentRide: ride,
        availableRides: currentList,
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

  Future<void> transitionStatus(String rideId, String newStatus, {String? pin}) async {
    state = state.copyWith(isUpdatingStatus: true, errorMessage: null);

    try {
      final ride = await ref.read(updateRideStatusUseCaseProvider).execute(rideId, newStatus, pin: pin);

      state = state.copyWith(
        isUpdatingStatus: false,
        currentRide: ride,
      );

      _handleRideStateChange(ride.status);
    } catch (e) {
      state = state.copyWith(
        isUpdatingStatus: false,
        errorMessage: e.toString().replaceFirst('ServerFailure: ', ''),
      );
    }
  }

  Future<bool> verifyPinAndStartRide(String rideId, String pin) async {
    final trimmed = pin.trim();
    if (trimmed.length != 4 || !RegExp(r'^\d{4}$').hasMatch(trimmed)) {
      state = state.copyWith(errorMessage: 'Please enter a valid 4-digit pickup PIN');
      return false;
    }

    state = state.copyWith(isUpdatingStatus: true, errorMessage: null);
    try {
      final ride = await ref.read(updateRideStatusUseCaseProvider).execute(
        rideId,
        'in_progress',
        pin: trimmed,
      );
      state = state.copyWith(
        isUpdatingStatus: false,
        currentRide: ride,
      );
      _handleRideStateChange(ride.status);
      return true;
    } catch (e) {
      state = state.copyWith(
        isUpdatingStatus: false,
        errorMessage: e.toString().replaceFirst('ServerFailure: ', ''),
      );
      return false;
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
