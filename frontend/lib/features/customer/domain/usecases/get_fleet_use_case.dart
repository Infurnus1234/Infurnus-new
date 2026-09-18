import '../../data/models/fleet_vehicle_model.dart';
import '../repositories/ride_repository.dart';

class GetFleetUseCase {
  final RideRepository repository;

  GetFleetUseCase(this.repository);

  Future<List<FleetVehicleModel>> call({String? sector, String? category}) {
    return repository.getFleet(sector: sector, category: category);
  }
}
