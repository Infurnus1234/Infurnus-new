import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/usecases/cancel_ride_use_case.dart';
import '../../domain/usecases/create_ride_use_case.dart';
import '../../domain/usecases/get_ride_use_case.dart';
import '../../domain/usecases/list_rides_use_case.dart';
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
