import 'package:flutter_riverpod/flutter_riverpod.dart';

enum RideStatus { initial, searching, matched, arrived, active, completed, cancelled }

class RideState {
  final RideStatus status;
  final String? pickup;
  final String? destination;
  final double? fare;
  final String? driverName;
  final String? vehicleInfo;

  RideState({
    this.status = RideStatus.initial,
    this.pickup,
    this.destination,
    this.fare,
    this.driverName,
    this.vehicleInfo,
  });

  RideState copyWith({
    RideStatus? status,
    String? pickup,
    String? destination,
    double? fare,
    String? driverName,
    String? vehicleInfo,
  }) {
    return RideState(
      status: status ?? this.status,
      pickup: pickup ?? this.pickup,
      destination: destination ?? this.destination,
      fare: fare ?? this.fare,
      driverName: driverName ?? this.driverName,
      vehicleInfo: vehicleInfo ?? this.vehicleInfo,
    );
  }
}

class RideNotifier extends StateNotifier<RideState> {
  RideNotifier() : super(RideState());

  void setRoute(String pickup, String dest) {
    state = state.copyWith(
      pickup: pickup,
      destination: dest,
      fare: 250.0, // Mock fare calculation
      status: RideStatus.initial,
    );
  }

  Future<void> requestRide() async {
    state = state.copyWith(status: RideStatus.searching);
    
    // Simulate driver matching after 3 seconds
    await Future.delayed(const Duration(seconds: 3));
    
    state = state.copyWith(
      status: RideStatus.matched,
      driverName: 'John Doe',
      vehicleInfo: 'White Toyota Camry (KA 01 AB 1234)',
    );
  }

  void cancelRide() {
    state = RideState();
  }
}

final rideProvider = StateNotifierProvider<RideNotifier, RideState>((ref) {
  return RideNotifier();
});
