import '../repositories/driver_repository.dart';

class VerifyRidePinUseCase {
  final DriverRepository repository;

  VerifyRidePinUseCase(this.repository);

  Future<bool> execute(String rideId, String pin) {
    return repository.verifyPin(rideId, pin);
  }
}
