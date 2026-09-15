import '../repositories/driver_repository.dart';
import '../../data/models/vehicle_model.dart';

class UpdateVehicleUseCase {
  final DriverRepository repository;

  UpdateVehicleUseCase(this.repository);

  Future<VehicleModel> execute(String id, Map<String, dynamic> data) {
    return repository.updateVehicle(id, data);
  }
}
