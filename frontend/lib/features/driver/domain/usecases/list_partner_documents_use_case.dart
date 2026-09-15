import '../repositories/driver_repository.dart';
import '../../data/models/partner_document_model.dart';

class ListPartnerDocumentsUseCase {
  final DriverRepository repository;

  ListPartnerDocumentsUseCase(this.repository);

  Future<List<PartnerDocumentModel>> execute(String partnerId) {
    return repository.listDocuments(partnerId);
  }
}
