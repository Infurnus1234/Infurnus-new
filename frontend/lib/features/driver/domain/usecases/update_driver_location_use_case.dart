import '../repositories/driver_repository.dart';

class UpdateDriverLocationUseCase {
  final DriverRepository repository;

  UpdateDriverLocationUseCase(this.repository);

  Future<void> execute(Map<String, dynamic> data) {
    return repository.updateLocation(data);
  }
}
