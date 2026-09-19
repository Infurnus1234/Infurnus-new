import '../repositories/ride_repository.dart';

class CapturePaymentUseCase {
  final RideRepository repository;

  CapturePaymentUseCase(this.repository);

  Future<Map<String, dynamic>> execute({
    required String paymentId,
    String? providerPaymentId,
  }) {
    return repository.capturePayment(
      paymentId: paymentId,
      providerPaymentId: providerPaymentId,
    );
  }
}
