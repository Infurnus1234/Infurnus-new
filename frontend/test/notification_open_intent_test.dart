import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/notification_service.dart';

void main() {
  test(
    'received updates do not navigate; opened ride survives a cold start',
    () async {
      final notifications = NotificationService(Dio());
      expect(
        notifications.handleRideMessage({
          'rideId': 'active-ride',
          'notificationId': 'one',
        }),
        isTrue,
      );
      expect(notifications.takePendingOpenedRide(), isNull);
      expect(
        notifications.handleRideMessage({
          'rideId': 'active-ride',
          'notificationId': 'one',
        }, opened: true),
        isTrue,
      );
      expect(notifications.takePendingOpenedRide(), 'active-ride');
      expect(notifications.takePendingOpenedRide(), isNull);
      expect(
        notifications.handleRideMessage({'route': '/admin'}, opened: true),
        isFalse,
      );
      notifications.dispose();
    },
  );
}
