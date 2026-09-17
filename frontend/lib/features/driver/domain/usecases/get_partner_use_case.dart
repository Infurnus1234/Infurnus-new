import '../repositories/driver_repository.dart';
import '../../data/models/partner_model.dart';

class GetPartnerUseCase {
  final DriverRepository repository;

  GetPartnerUseCase(this.repository);

  Future<PartnerModel> execute(String id) {
    return repository.getPartner(id);
  }
}
