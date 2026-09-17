import '../repositories/driver_repository.dart';
import '../../data/models/partner_model.dart';

class UpdatePartnerUseCase {
  final DriverRepository repository;

  UpdatePartnerUseCase(this.repository);

  Future<PartnerModel> execute(String id, Map<String, dynamic> data) {
    return repository.updatePartner(id, data);
  }
}
