import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/dio_client.dart';
import '../../data/datasources/ride_remote_data_source.dart';
import '../../data/repositories/ride_repository_impl.dart';
import '../../domain/repositories/ride_repository.dart';

final rideRemoteDataSourceProvider = Provider<RideRemoteDataSource>((ref) {
  final dio = ref.watch(dioProvider);
  return RideRemoteDataSourceImpl(dio);
});

final rideRepositoryProvider = Provider<RideRepository>((ref) {
  final remoteDataSource = ref.watch(rideRemoteDataSourceProvider);
  return RideRepositoryImpl(remoteDataSource);
});
