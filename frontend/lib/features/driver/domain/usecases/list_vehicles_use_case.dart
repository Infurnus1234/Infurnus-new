import '../repositories/driver_repository.dart';
import '../../data/models/vehicle_model.dart';

class ListVehiclesUseCase {
  final DriverRepository repository;

  ListVehiclesUseCase(this.repository);

  Future<List<VehicleModel>> execute(String driverProfileId) {
    return repository.listVehicles(driverProfileId: driverProfileId);
  }
}
