import '../repositories/driver_repository.dart';

class DeclineRideUseCase {
  final DriverRepository repository;

  DeclineRideUseCase(this.repository);

  Future<void> execute(String rideId) => repository.declineRide(rideId);
}
