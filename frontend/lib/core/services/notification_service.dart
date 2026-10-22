import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';

import '../network/dio_client.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  debugPrint('Handling a background message: ${message.messageId}');
}

class NotificationService {
  final Dio _dio;
  final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  NotificationService(this._dio);
  String? _registeredId;

  Future<void> init() async {
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      const AndroidInitializationSettings initializationSettingsAndroid =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const DarwinInitializationSettings initializationSettingsIOS =
          DarwinInitializationSettings();

      const InitializationSettings initializationSettings =
          InitializationSettings(
            android: initializationSettingsAndroid,
            iOS: initializationSettingsIOS,
          );

      await _notificationsPlugin.initialize(
        initializationSettings,
        onDidReceiveNotificationResponse: (details) {
          debugPrint('Notification tapped with payload: ${details.payload}');
        },
      );

      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.authorized) {
        debugPrint('User granted push notification permission');

        final fcmToken = await messaging.getToken();
        if (fcmToken != null) {
          await registerDeviceToken(fcmToken);
        }

        messaging.onTokenRefresh.listen((newToken) {
          registerDeviceToken(newToken);
        });

        FirebaseMessaging.onMessage.listen((RemoteMessage message) {
          debugPrint(
            'Received foreground message: ${message.notification?.title}',
          );
          final notification = message.notification;
          if (notification != null) {
            showNotification(
              id: notification.hashCode,
              title: notification.title ?? 'Infurnus',
              body: notification.body ?? '',
              payload: message.data['rideId'] ?? message.data['payload'],
            );
          }
        });
      } else {
        debugPrint(
          'User declined or has not accepted push notification permission',
        );
      }
    } catch (e) {
      debugPrint('Notification initialization error: $e');
    }
  }

  Future<void> syncAuthenticatedDevice() async {
    try {
      if (kIsWeb || Firebase.apps.isEmpty) return;
      final settings = await FirebaseMessaging.instance
          .getNotificationSettings();
      if (settings.authorizationStatus != AuthorizationStatus.authorized &&
          settings.authorizationStatus != AuthorizationStatus.provisional) {
        return;
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) await registerDeviceToken(token);
    } catch (e) {
      debugPrint('Push registration unavailable: ${e.runtimeType}');
    }
  }

  Future<void> unregisterDevice() async {
    final id =
        _registeredId ?? await _storage.read(key: 'push_device_record_id');
    try {
      if (id != null) {
        await _dio
            .delete('/notifications/devices/$id')
            .timeout(const Duration(seconds: 5));
      }
    } catch (e) {
      debugPrint('Push cleanup unavailable: ${e.runtimeType}');
    } finally {
      _registeredId = null;
      await _storage.delete(key: 'push_device_record_id');
    }
  }

  Future<void> registerDeviceToken(String fcmToken) async {
    try {
      if (fcmToken.isEmpty || await _storage.read(key: 'auth_token') == null) {
        return;
      }
      String? deviceId = await _storage.read(key: 'device_id');
      if (deviceId == null) {
        deviceId =
            'device_${DateTime.now().millisecondsSinceEpoch}_${defaultTargetPlatform.name}';
        await _storage.write(key: 'device_id', value: deviceId);
      }

      final platform = defaultTargetPlatform == TargetPlatform.iOS
          ? 'IOS'
          : 'ANDROID';

      final response = await _dio.post(
        '/notifications/devices',
        data: {
          'fcmToken': fcmToken,
          'platform': platform,
          'deviceId': deviceId,
        },
      );
      final data = response.data;
      if (data is Map && data['data'] is Map && data['data']['id'] is String) {
        _registeredId = data['data']['id'] as String;
        await _storage.write(
          key: 'push_device_record_id',
          value: _registeredId,
        );
      }
      debugPrint('Device token successfully registered with backend');
    } catch (e) {
      debugPrint('Failed to register device token with backend: $e');
    }
  }

  Future<void> showNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    const AndroidNotificationDetails androidDetails =
        AndroidNotificationDetails(
          'infurnus_channel',
          'Infurnus Notifications',
          importance: Importance.max,
          priority: Priority.high,
        );

    const NotificationDetails platformDetails = NotificationDetails(
      android: androidDetails,
      iOS: DarwinNotificationDetails(),
    );

    await _notificationsPlugin.show(
      id,
      title,
      body,
      platformDetails,
      payload: payload,
    );
  }
}

final notificationServiceProvider = Provider(
  (ref) => NotificationService(ref.read(dioProvider)),
);
