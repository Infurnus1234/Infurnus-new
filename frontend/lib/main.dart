import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/services/notification_service.dart';
import 'core/services/location_access.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final container = ProviderContainer();
  try {
    await container
        .read(notificationServiceProvider)
        .init()
        .timeout(const Duration(seconds: 5));
  } catch (e) {
    debugPrint('Notification service init failed: $e');
  }

  runApp(
    UncontrolledProviderScope(container: container, child: const InfurnusApp()),
  );
  WidgetsBinding.instance.addPostFrameCallback((_) => locationAccess.start());
}
