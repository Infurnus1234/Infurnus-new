import '../repositories/driver_repository.dart';
import '../../data/models/vehicle_model.dart';

class DeactivateVehicleUseCase {
  final DriverRepository repository;

  DeactivateVehicleUseCase(this.repository);

  Future<VehicleModel> execute(String id) {
    return repository.deactivateVehicle(id);
  }
}
