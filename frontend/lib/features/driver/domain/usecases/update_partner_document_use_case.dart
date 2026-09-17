import '../repositories/driver_repository.dart';
import '../../data/models/partner_document_model.dart';

class UpdatePartnerDocumentUseCase {
  final DriverRepository repository;

  UpdatePartnerDocumentUseCase(this.repository);

  Future<PartnerDocumentModel> execute(String partnerId, String documentId, Map<String, dynamic> data) {
    return repository.updateDocument(partnerId, documentId, data);
  }
}
