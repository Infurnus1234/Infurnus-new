import '../repositories/ride_repository.dart';

class InitiatePaymentUseCase {
  final RideRepository repository;

  InitiatePaymentUseCase(this.repository);

  Future<Map<String, dynamic>> execute({
    required String rideId,
    required double amount,
    required String paymentMethod,
  }) {
    return repository.initiatePayment(
      rideId: rideId,
      amount: amount,
      paymentMethod: paymentMethod,
    );
  }
}
