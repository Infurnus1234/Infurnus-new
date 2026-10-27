import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:infurnus/core/services/notification_service.dart';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart'
    as model;
import 'package:infurnus/features/customer/domain/repositories/ride_repository.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';

class _Socket extends SocketService {
  final events = StreamController<SocketServerEvent>.broadcast();
  @override
  Stream<SocketServerEvent> get eventStream => events.stream;
  @override
  SocketConnectionState get currentState => SocketConnectionState.connected;
  @override
  void joinRide(String id) {}
  @override
  void leaveRide(String id) {}
  @override
  void dispose() {
    events.close();
    super.dispose();
  }
}

class _Repository implements RideRepository {
  model.RideModel ride;
  int reads = 0;
  _Repository(this.ride);
  @override
  Future<model.RideModel> getRide(String id) async {
    reads++;
    return ride;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final trace = jsonDecode(
    File('test/fixtures/actual_notification_route.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  test('actual backend assignment reaches Customer state and late events cannot reopen cancelled ride', () async {
    final socket = _Socket();
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) => h.resolve(
          Response(
            requestOptions: o,
            data: {
              'data': {'distanceMeters': 1000, 'durationSeconds': 120},
            },
          ),
        ),
      ),
    );
    final notifications = NotificationService(dio);
    final repository = _Repository(
      model.RideModel.fromJson(trace['bookingRide']),
    );
    final c = ProviderContainer(
      overrides: [
        dioProvider.overrideWithValue(dio),
        socketServiceProvider.overrideWithValue(socket),
        rideRepositoryProvider.overrideWithValue(repository),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
    );
    addTearDown(() {
      c.dispose();
      socket.dispose();
      notifications.dispose();
    });
    await c.read(rideProvider.notifier).getRideDetails(repository.ride.id);
    socket.events.add(
      SocketServerEvent(
        name: 'ride:driver_assigned',
        data: {'ride': trace['customerRide']},
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(c.read(rideProvider).status, RideStatus.matched);
    expect(
      c.read(rideProvider).currentRide!.assignedDriverId,
      trace['customerRide']['assignedDriverId'],
    );
    socket.events.add(
      SocketServerEvent(
        name: 'ride:cancelled',
        data: {'rideId': repository.ride.id},
      ),
    );
    await Future<void>.delayed(Duration.zero);
    socket.events.add(
      SocketServerEvent(
        name: 'ride:driver_assigned',
        data: {'ride': trace['customerRide']},
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(c.read(rideProvider).status, RideStatus.cancelled);
  });
  test('push open reconciles through repository and rejects duplicates and expired hints', () async {
    final socket = _Socket();
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) => h.resolve(
          Response(
            requestOptions: o,
            data: {
              'data': {'distanceMeters': 1000, 'durationSeconds': 120},
            },
          ),
        ),
      ),
    );
    final notifications = NotificationService(dio);
    final repository = _Repository(
      model.RideModel.fromJson(trace['customerRide']),
    );
    final id = repository.ride.id;
    expect(
      notifications.handleRideMessage({'rideId': id}, opened: true),
      isTrue,
    );
    final c = ProviderContainer(
      overrides: [
        dioProvider.overrideWithValue(dio),
        socketServiceProvider.overrideWithValue(socket),
        rideRepositoryProvider.overrideWithValue(repository),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
    );
    addTearDown(() {
      c.dispose();
      socket.dispose();
      notifications.dispose();
    });
    c.read(rideProvider);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(repository.reads, 1);
    expect(c.read(rideProvider).status, RideStatus.matched);
    expect(
      notifications.handleRideMessage({'rideId': id, 'notificationId': 'one'}),
      isTrue,
    );
    expect(
      notifications.handleRideMessage({'rideId': id, 'notificationId': 'one'}),
      isFalse,
    );
    expect(
      notifications.handleRideMessage({
        'rideId': id,
        'expiresAt': '2000-01-01T00:00:00Z',
      }),
      isFalse,
    );
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(repository.reads, 2);
  });
}
