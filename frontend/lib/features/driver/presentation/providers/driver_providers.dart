import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/dio_client.dart';
import '../../data/datasources/driver_remote_data_source.dart';
import '../../data/repositories/driver_repository_impl.dart';
import '../../domain/repositories/driver_repository.dart';
import '../../domain/usecases/add_partner_document_use_case.dart';
import '../../domain/usecases/become_partner_use_case.dart';
import '../../domain/usecases/create_vehicle_use_case.dart';
import '../../domain/usecases/deactivate_vehicle_use_case.dart';
import '../../domain/usecases/get_partner_use_case.dart';
import '../../domain/usecases/get_user_history_use_case.dart';
import '../../domain/usecases/get_user_preferences_use_case.dart';
import '../../domain/usecases/list_partner_documents_use_case.dart';
import '../../domain/usecases/list_vehicles_use_case.dart';
import '../../domain/usecases/update_driver_availability_use_case.dart';
import '../../domain/usecases/accept_ride_use_case.dart';
import '../../domain/usecases/update_driver_location_use_case.dart';
import '../../domain/usecases/complete_ride_use_case.dart';
import '../../domain/usecases/update_partner_document_use_case.dart';
import '../../domain/usecases/update_partner_use_case.dart';
import '../../domain/usecases/update_ride_status_use_case.dart';
import '../../domain/usecases/update_user_preferences_use_case.dart';
import '../../domain/usecases/update_vehicle_use_case.dart';

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

final getPartnerUseCaseProvider = Provider<GetPartnerUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return GetPartnerUseCase(repository);
});

final updatePartnerUseCaseProvider = Provider<UpdatePartnerUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return UpdatePartnerUseCase(repository);
});

final listVehiclesUseCaseProvider = Provider<ListVehiclesUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return ListVehiclesUseCase(repository);
});

final createVehicleUseCaseProvider = Provider<CreateVehicleUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return CreateVehicleUseCase(repository);
});

final updateVehicleUseCaseProvider = Provider<UpdateVehicleUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return UpdateVehicleUseCase(repository);
});

final deactivateVehicleUseCaseProvider = Provider<DeactivateVehicleUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return DeactivateVehicleUseCase(repository);
});

final listPartnerDocumentsUseCaseProvider = Provider<ListPartnerDocumentsUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return ListPartnerDocumentsUseCase(repository);
});

final addPartnerDocumentUseCaseProvider = Provider<AddPartnerDocumentUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return AddPartnerDocumentUseCase(repository);
});

final updatePartnerDocumentUseCaseProvider = Provider<UpdatePartnerDocumentUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return UpdatePartnerDocumentUseCase(repository);
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

final updateRideStatusUseCaseProvider = Provider<UpdateRideStatusUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return UpdateRideStatusUseCase(repository);
});

final getUserPreferencesUseCaseProvider = Provider<GetUserPreferencesUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return GetUserPreferencesUseCase(repository);
});

final updateUserPreferencesUseCaseProvider = Provider<UpdateUserPreferencesUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return UpdateUserPreferencesUseCase(repository);
});

final getUserHistoryUseCaseProvider = Provider<GetUserHistoryUseCase>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return GetUserHistoryUseCase(repository);
});
