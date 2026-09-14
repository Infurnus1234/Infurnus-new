import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/dio_client.dart';
import '../../data/datasources/driver_remote_data_source.dart';
import '../../data/repositories/driver_repository_impl.dart';
import '../../domain/repositories/driver_repository.dart';
import '../../domain/usecases/become_partner_use_case.dart';
import '../../domain/usecases/update_driver_availability_use_case.dart';
import '../../domain/usecases/accept_ride_use_case.dart';
import '../../domain/usecases/update_driver_location_use_case.dart';
import '../../domain/usecases/complete_ride_use_case.dart';

final driverRemoteDataSourceProvider = Provider<DriverRemoteDataSource>((ref) {
  final dio = ref.watch(dioProvider);
  return DriverRemoteDataSourceImpl(dio);
});

final driverRepositoryProvider = Provider<DriverRepository>((ref) {
  final remoteDataSource = ref.watch(driverRemoteDataSourceProvider);
  return DriverRepositoryImpl(remoteDataSource);
});

final becomePartnerUseCaseProvider = Provider<BecomePartnerUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return BecomePartnerUseCase(repository);
});

final updateDriverAvailabilityUseCaseProvider = Provider<UpdateDriverAvailabilityUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return UpdateDriverAvailabilityUseCase(repository);
});

final acceptRideUseCaseProvider = Provider<AcceptRideUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return AcceptRideUseCase(repository);
});

final updateDriverLocationUseCaseProvider = Provider<UpdateDriverLocationUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return UpdateDriverLocationUseCase(repository);
});

final completeRideUseCaseProvider = Provider<CompleteRideUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return CompleteRideUseCase(repository);
});
