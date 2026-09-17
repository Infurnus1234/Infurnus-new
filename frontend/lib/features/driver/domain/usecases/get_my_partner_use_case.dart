import '../../data/models/partner_model.dart';
import '../repositories/driver_repository.dart';

class GetMyPartnerUseCase {
  final DriverRepository repository;

  GetMyPartnerUseCase(this.repository);

  Future<PartnerModel?> execute() {
    return repository.getMyPartner();
  }
}
