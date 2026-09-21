import '../repositories/ride_repository.dart';

class SubmitRatingUseCase {
  final RideRepository repository;

  SubmitRatingUseCase(this.repository);

  Future<Map<String, dynamic>> execute({
    required String rideId,
    required int rating,
    String? review,
  }) {
    return repository.submitRating(
      rideId: rideId,
      rating: rating,
      review: review,
    );
  }
}
