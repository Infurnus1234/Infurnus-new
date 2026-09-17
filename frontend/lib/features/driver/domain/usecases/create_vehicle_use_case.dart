import '../repositories/driver_repository.dart';
import '../../data/models/vehicle_model.dart';

class CreateVehicleUseCase {
  final DriverRepository repository;

  CreateVehicleUseCase(this.repository);

  Future<VehicleModel> execute(Map<String, dynamic> data) {
    return repository.createVehicle(data);
  }
}
