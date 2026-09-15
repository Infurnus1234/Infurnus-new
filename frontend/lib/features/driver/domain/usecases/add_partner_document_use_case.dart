import '../repositories/driver_repository.dart';
import '../../data/models/partner_document_model.dart';

class AddPartnerDocumentUseCase {
  final DriverRepository repository;

  AddPartnerDocumentUseCase(this.repository);

  Future<PartnerDocumentModel> execute(String partnerId, Map<String, dynamic> data) {
    return repository.addDocument(partnerId, data);
  }
}
