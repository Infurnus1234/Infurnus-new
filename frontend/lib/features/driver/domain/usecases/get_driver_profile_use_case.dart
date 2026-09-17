import '../../data/models/driver_profile_model.dart';
import '../repositories/driver_repository.dart';

class GetDriverProfileUseCase {
  final DriverRepository repository;

  GetDriverProfileUseCase(this.repository);

  Future<DriverProfileModel?> execute() {
    return repository.getDriverProfile();
  }
}
