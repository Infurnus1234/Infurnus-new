import '../repositories/driver_repository.dart';

class UpdateDriverAvailabilityUseCase {
  final DriverRepository repository;

  UpdateDriverAvailabilityUseCase(this.repository);

  Future<void> execute(String status) {
    return repository.updateAvailability(status);
  }
}
