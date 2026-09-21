import '../../data/models/driver_profile_model.dart';
import '../repositories/driver_repository.dart';

class UpsertDriverProfileUseCase {
  final DriverRepository repository;

  UpsertDriverProfileUseCase(this.repository);

  Future<DriverProfileModel> execute(Map<String, dynamic> data) {
    return repository.upsertDriverProfile(data);
  }
}
