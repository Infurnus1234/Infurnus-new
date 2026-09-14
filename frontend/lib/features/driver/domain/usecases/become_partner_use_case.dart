import '../repositories/driver_repository.dart';
import '../../data/models/partner_model.dart';

class BecomePartnerUseCase {
  final DriverRepository repository;

  BecomePartnerUseCase(this.repository);

  Future<PartnerModel> execute(Map<String, dynamic> data) {
    return repository.createPartner(data);
  }
}
