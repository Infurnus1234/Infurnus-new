import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme/app_theme.dart';
import '../core/services/notification_service.dart';
import '../features/auth/presentation/providers/auth_provider.dart';
import '../features/auth/presentation/providers/user_provider.dart';
import '../features/customer/presentation/providers/ride_provider.dart';
import 'router/router.dart';

class InfurnusApp extends ConsumerStatefulWidget {
  const InfurnusApp({super.key});
  @override
  ConsumerState<InfurnusApp> createState() => _InfurnusAppState();
}

class _InfurnusAppState extends ConsumerState<InfurnusApp>
    with WidgetsBindingObserver {
  StreamSubscription<String>? _opened;
  Future<void>? _recovery;
  String? _pendingOpen;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final notifications = ref.read(notificationServiceProvider);
    _pendingOpen = notifications.takePendingOpenedRide();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_recover());
    });
    _opened = notifications.openedRides.listen((id) {
      _pendingOpen = id;
      unawaited(_recover());
    });
  }

  Future<void> _recover() {
    if (!mounted) {
      return Future.value();
    }
    if (ref.read(authProvider).status != AuthStatus.authenticated ||
        ref.read(userProvider)?.role != 'customer') {
      return Future.value();
    }
    return _recovery ??= _recoverRide().whenComplete(() => _recovery = null);
  }

  Future<void> _recoverRide() async {
    final id = _pendingOpen;
    if (id != null) {
      await ref.read(rideProvider.notifier).getRideDetails(id);
      if (!mounted || ref.read(rideProvider).currentRide?.id != id) return;
      if (_pendingOpen == id) _pendingOpen = null;
      ref.read(routerProvider).go('/ride-booking');
    } else {
      await ref.read(rideProvider.notifier).restoreActiveRide();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // UI lifecycle never sends a ride/availability mutation or disconnects GPS.
    if (state == AppLifecycleState.resumed) unawaited(_recover());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _opened?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authProvider, (previous, next) {
      if (next.status == AuthStatus.authenticated &&
          previous?.status != next.status) {
        Future.microtask(_recover);
      }
    });
    return MaterialApp.router(
      title: 'INFURNUS',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
