import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/core/services/map_service.dart';
import 'package:infurnus/core/services/notification_service.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/shared/widgets/infurnus_map.dart';

class NoGps extends LocationService {
  @override
  Future<Position?> getCurrentPosition() async => null;
  @override
  Stream<Position> getPositionStream() => const Stream.empty();
}

final creations = ValueNotifier<int>(0);

class AuditMap extends GoogleMapServiceImpl {
  @override
  void onMapCreated(GoogleMapController controller) {
    super.onMapCreated(controller);
    creations.value++;
  }
}

final local = FlutterLocalNotificationsPlugin();
final messages = NotificationService(Dio());
final opened = ValueNotifier<String>('none');
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await local.initialize(
    const InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    ),
    onDidReceiveNotificationResponse: (r) {
      if (r.payload != null) {
        messages.handleRideMessage(
          jsonDecode(r.payload!) as Map<String, dynamic>,
          opened: true,
        );
      }
    },
  );
  messages.openedRides.listen((id) => opened.value = id);
  runApp(
    ProviderScope(
      overrides: [
        locationServiceProvider.overrideWithValue(NoGps()),
        mapServiceProvider.overrideWith((ref, owner) => AuditMap()),
      ],
      child: const AuditApp(),
    ),
  );
}

class AuditApp extends StatefulWidget {
  const AuditApp({super.key});
  @override
  State<AuditApp> createState() => _AuditState();
}

class _AuditState extends State<AuditApp> {
  Timer? timer;
  int step = 0;
  String status = 'driver_assigned';
  double lat = 25.5941, lng = 85.1376;
  late DriverLocation fix;
  static const directions = [
    (1, 0, 0),
    (1, 1, 45),
    (0, 1, 90),
    (-1, 1, 135),
    (-1, 0, 180),
    (-1, -1, 225),
    (0, -1, 270),
    (1, -1, 315),
  ];
  DriverLocation sample() => DriverLocation(
    latitude: lat,
    longitude: lng,
    timestamp: DateTime.now(),
    heading: ((directions[(step ~/ 4) % 8].$3 + 180) % 360).toDouble(),
    speed: 5,
    accuracy: 1,
  );
  @override
  void initState() {
    super.initState();
    fix = sample();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      final d = directions[(step ~/ 4) % 8];
      setState(() {
        lat += d.$1 * .000045;
        lng += d.$2 * .000045;
        fix = sample();
        step++;
      });
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Scaffold(
      appBar: AppBar(title: const Text('LOCAL USER AUDIT')),
      body: Column(
        children: [
          const Text(
            'Synthetic GPS fixture. No production API or stored session.',
          ),
          Text(
            'State: $status / Expected course: ${directions[((step == 0 ? 0 : step - 1) ~/ 4) % 8].$3} degrees',
          ),
          ValueListenableBuilder(
            valueListenable: creations,
            builder: (_, n, _) => Text('Native map creations: $n'),
          ),
          ValueListenableBuilder(
            valueListenable: opened,
            builder: (_, id, _) => Text('Opened ride: $id'),
          ),
          Wrap(
            children: [
              for (final phase in [
                'requested',
                'driver_assigned',
                'driver_arrived',
                'in_progress',
              ])
                TextButton(
                  onPressed: () => setState(() => status = phase),
                  child: Text(phase),
                ),
            ],
          ),
          TextButton(
            onPressed: () => local.show(
              117,
              'Local ride audit',
              'Tap to return to the local ride',
              const NotificationDetails(
                android: AndroidNotificationDetails(
                  'infurnus_local_audit',
                  'Local ride audit',
                  importance: Importance.high,
                  priority: Priority.high,
                ),
              ),
              payload: jsonEncode({
                'rideId': 'local-audit-ride',
                'notificationId': 'local-open',
              }),
            ),
            child: const Text('Send local test notification'),
          ),
          Expanded(
            child: InfurnusMap(
              key: const ValueKey('local-map'),
              rideStatus: status,
              pickup: const LatLng(25.5941, 85.1376),
              destination: const LatLng(25.6, 85.14),
              driverLocation: fix,
              initialCameraPosition: const CameraPosition(
                target: LatLng(25.5941, 85.1376),
                zoom: 17,
                bearing: 120,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
