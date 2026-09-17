import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/usecases/cancel_ride_use_case.dart';
import '../../domain/usecases/create_ride_use_case.dart';
import '../../domain/usecases/estimate_fare_use_case.dart';
import '../../domain/usecases/get_ride_use_case.dart';
import '../../domain/usecases/list_rides_use_case.dart';
import '../../domain/usecases/initiate_payment_use_case.dart';
import '../../domain/usecases/list_payments_use_case.dart';
import '../../domain/usecases/submit_rating_use_case.dart';
import 'ride_repository_provider.dart';

final createRideUseCaseProvider = Provider<CreateRideUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return CreateRideUseCase(repository);
});

final listRidesUseCaseProvider = Provider<ListRidesUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return ListRidesUseCase(repository);
});

final getRideUseCaseProvider = Provider<GetRideUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return GetRideUseCase(repository);
});

final cancelRideUseCaseProvider = Provider<CancelRideUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return CancelRideUseCase(repository);
});

final estimateFareUseCaseProvider = Provider<EstimateFareUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return EstimateFareUseCase(repository);
});

final submitRatingUseCaseProvider = Provider<SubmitRatingUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return SubmitRatingUseCase(repository);
});

final initiatePaymentUseCaseProvider = Provider<InitiatePaymentUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return InitiatePaymentUseCase(repository);
});

final listPaymentsUseCaseProvider = Provider<ListPaymentsUseCase>((ref) {
  final repository = ref.watch(rideRepositoryProvider);
  return ListPaymentsUseCase(repository);
});

