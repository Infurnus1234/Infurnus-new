import '../repositories/ride_repository.dart';

class ListPaymentsUseCase {
  final RideRepository repository;

  ListPaymentsUseCase(this.repository);

  Future<List<Map<String, dynamic>>> execute({int? limit}) {
    return repository.listPayments(limit: limit);
  }
}
