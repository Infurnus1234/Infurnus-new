import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/services/socket_service.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/ride_model.dart' as model;
import '../../data/models/route_model.dart';
import 'ride_use_case_providers.dart';

enum RideStatus { initial, searching, matched, arrived, active, completed, cancelled, error }

class DriverLocation {
  final double latitude;
  final double longitude;
  final DateTime timestamp;

  DriverLocation({
    required this.latitude,
    required this.longitude,
    required this.timestamp,
  });
}

class RideState {
  final RideStatus status;
  final String? pickup;
  final String? destination;
  final double? fare;
  final String? driverName;
  final String? vehicleInfo;
  final model.RideModel? currentRide;
  final List<model.RideModel> history;
  final String? errorMessage;
  final DriverLocation? lastDriverLocation;
  final RouteModel? currentRoute; // Typed RouteModel

  RideState({
    this.status = RideStatus.initial,
    this.pickup,
    this.destination,
    this.fare,
    this.driverName,
    this.vehicleInfo,
    this.currentRide,
    this.history = const [],
    this.errorMessage,
    this.lastDriverLocation,
    this.currentRoute,
  });

  RideState copyWith({
    RideStatus? status,
    String? pickup,
    String? destination,
    double? fare,
    String? driverName,
    String? vehicleInfo,
    model.RideModel? currentRide,
    List<model.RideModel>? history,
    String? errorMessage,
    DriverLocation? lastDriverLocation,
    RouteModel? currentRoute,
  }) {
    return RideState(
      status: status ?? this.status,
      pickup: pickup ?? this.pickup,
      destination: destination ?? this.destination,
      fare: fare ?? this.fare,
      driverName: driverName ?? this.driverName,
      vehicleInfo: vehicleInfo ?? this.vehicleInfo,
      currentRide: currentRide ?? this.currentRide,
      history: history ?? this.history,
      errorMessage: errorMessage ?? this.errorMessage,
      lastDriverLocation: lastDriverLocation ?? this.lastDriverLocation,
      currentRoute: currentRoute ?? this.currentRoute,
    );
  }
}

class RideNotifier extends StateNotifier<RideState> {
  final Ref ref;
  StreamSubscription<SocketServerEvent>? _eventSubscription;

  RideNotifier(this.ref) : super(RideState()) {
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
      case 'ride:driver_assigned':
      case 'ride:lifecycle_updated':
        final rideData = event.data['ride'];
        if (rideData != null) {
          final updatedRide = model.RideModel.fromJson(rideData as Map<String, dynamic>);
          if (updatedRide.id == state.currentRide?.id) {
            state = state.copyWith(
              status: _mapBackendStatus(updatedRide.status),
              currentRide: updatedRide,
            );
            _checkRoomLifecycle(updatedRide.status);
          }
        }
        break;

      case 'ride:driver_location_updated':
        final rideId = event.data['rideId'];
        if (rideId == state.currentRide?.id) {
          final locationData = event.data['location'];
          if (locationData != null) {
            state = state.copyWith(
              lastDriverLocation: DriverLocation(
                latitude: (locationData['latitude'] as num).toDouble(),
                longitude: (locationData['longitude'] as num).toDouble(),
                timestamp: DateTime.parse(locationData['timestamp'] as String),
              ),
            );
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

  Future<void> _ensureSocketConnected() async {
    final socketService = ref.read(socketServiceProvider);
    if (socketService.currentState != SocketConnectionState.connected) {
      final token = await ref.read(secureStorageProvider).read(key: 'auth_token');
      if (token != null) {
        socketService.connect(token);
      }
    }
  }

  void _checkRoomLifecycle(model.RideStatus backendStatus) {
    if (backendStatus == model.RideStatus.completed || 
        backendStatus == model.RideStatus.cancelled) {
      if (state.currentRide?.id != null) {
        ref.read(socketServiceProvider).leaveRide(state.currentRide!.id);
      }
    }
  }

  void setRoute(String pickup, String dest) {
    state = state.copyWith(
      pickup: pickup,
      destination: dest,
      fare: 250.0,
      status: RideStatus.initial,
      errorMessage: null,
      lastDriverLocation: null,
      currentRoute: null,
    );
  }

  Future<void> requestRide() async {
    if (state.status == RideStatus.searching) return;

    state = state.copyWith(status: RideStatus.searching, errorMessage: null);
    
    try {
      final data = {
        'pickup': {'latitude': 12.9716, 'longitude': 77.5946},
        'destination': {'latitude': 12.9716, 'longitude': 77.6946},
        'pickupAddress': state.pickup,
        'destinationAddress': state.destination,
      };

      final ride = await ref.read(createRideUseCaseProvider).execute(data);
      
      state = state.copyWith(
        status: _mapBackendStatus(ride.status),
        currentRide: ride,
      );

      await _ensureSocketConnected();
      ref.read(socketServiceProvider).joinRide(ride.id);
    } catch (e) {
      state = state.copyWith(status: RideStatus.error, errorMessage: e.toString());
    }
  }

  Future<void> fetchRideHistory() async {
    try {
      final history = await ref.read(listRidesUseCaseProvider).execute(limit: 20);
      state = state.copyWith(history: history);
    } catch (e) {
      state = state.copyWith(errorMessage: e.toString());
    }
  }

  Future<void> getRideDetails(String id) async {
    try {
      final ride = await ref.read(getRideUseCaseProvider).execute(id);
      state = state.copyWith(
        status: _mapBackendStatus(ride.status),
        currentRide: ride,
      );

      await _ensureSocketConnected();
      ref.read(socketServiceProvider).joinRide(id);
      _checkRoomLifecycle(ride.status);
    } catch (e) {
      state = state.copyWith(errorMessage: e.toString());
    }
  }

  Future<void> cancelRide() async {
    final rideId = state.currentRide?.id;
    if (rideId == null) return;
    
    try {
      final ride = await ref.read(cancelRideUseCaseProvider).execute(
        rideId,
        'Cancelled by user',
      );
      
      ref.read(socketServiceProvider).leaveRide(rideId);

      state = state.copyWith(
        status: RideStatus.cancelled,
        currentRide: ride,
      );
      fetchRideHistory();
    } catch (e) {
      state = state.copyWith(errorMessage: e.toString());
    }
  }

  RideStatus _mapBackendStatus(model.RideStatus backendStatus) {
    switch (backendStatus) {
      case model.RideStatus.requested:
      case model.RideStatus.searching:
        return RideStatus.searching;
      case model.RideStatus.driverAssigned:
      case model.RideStatus.driverArriving:
        return RideStatus.matched;
      case model.RideStatus.driverArrived:
        return RideStatus.arrived;
      case model.RideStatus.inProgress:
        return RideStatus.active;
      case model.RideStatus.completed:
        return RideStatus.completed;
      case model.RideStatus.cancelled:
        return RideStatus.cancelled;
    }
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    super.dispose();
  }
}

final rideProvider = StateNotifierProvider<RideNotifier, RideState>((ref) {
  return RideNotifier(ref);
});
