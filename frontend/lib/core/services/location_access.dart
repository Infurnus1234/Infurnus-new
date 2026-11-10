import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';

enum LocationAccessIssue {
  permissionDenied('Allow location access to use your current position.'),
  permissionBlocked('Location access is blocked. Allow it in App permissions.'),
  servicesOff('Location is off. Try again to enable it.'),
  resolutionUnavailable('Turn on location in your device location settings.'),
  unavailable('Could not check location access. Try again.');

  const LocationAccessIssue(this.message);
  final String message;
}

/// One coordinator for startup, foreground changes and location consumers.
class LocationAccess with WidgetsBindingObserver {
  static const _channel = MethodChannel('infurnus/location_settings');
  final _changes = StreamController<LocationAccessIssue?>.broadcast();
  StreamSubscription<ServiceStatus>? _serviceSubscription;
  Future<LocationAccessIssue?>? _pending;
  LocationAccessIssue? _lastIssue;
  bool _checked = false;
  bool _started = false;
  bool _refreshQueued = false;
  bool _permissionAsked = false;
  bool _permissionBlocked = false;
  bool _resolutionOffered = false;
  bool _resolutionUnavailable = false;

  Stream<LocationAccessIssue?> get changes => _changes.stream;

  bool get _android =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  bool get _foreground =>
      !_started ||
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  void start() {
    if (!_android || _started) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
    _serviceSubscription = Geolocator.getServiceStatusStream().listen(
      (status) {
        if (status == ServiceStatus.enabled) {
          _resolutionOffered = false;
          _resolutionUnavailable = false;
        } else {
          _publish(LocationAccessIssue.servicesOff);
        }
        if (_foreground) _refresh();
      },
      onError: (Object _) {
        // A foreground check still works if the platform status stream fails.
      },
    );
    _refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _refresh() {
    if (_pending != null) {
      _refreshQueued = true;
    } else {
      unawaited(check());
    }
  }

  Future<LocationAccessIssue?> check({
    bool retry = false,
    bool interactive = true,
  }) {
    return _pending ??= _check(retry: retry, interactive: interactive)
        .then((issue) {
          _publish(issue);
          return issue;
        })
        .whenComplete(() {
          _pending = null;
          if (_refreshQueued) {
            _refreshQueued = false;
            if (_started && _foreground) _refresh();
          }
        });
  }

  void _publish(LocationAccessIssue? issue) {
    if (_checked && issue == _lastIssue) return;
    _checked = true;
    _lastIssue = issue;
    _changes.add(issue);
  }

  bool _granted(LocationPermission permission) =>
      permission == LocationPermission.always ||
      permission == LocationPermission.whileInUse;

  Future<bool> _isServiceEnabled() async {
    if (_android) {
      try {
        final enabled = await _channel.invokeMethod<bool>('isEnabled');
        if (enabled != null) return enabled;
      } on MissingPluginException {
        // The plugin also supports hosts without the Android bridge.
      }
    }
    return Geolocator.isLocationServiceEnabled();
  }

  Future<LocationAccessIssue?> _check({
    required bool retry,
    required bool interactive,
  }) async {
    try {
      var permission = await Geolocator.checkPermission();
      var justRequestedPermission = false;
      if (_granted(permission)) {
        _permissionAsked = false;
        _permissionBlocked = false;
      }
      if (permission == LocationPermission.deniedForever) {
        _permissionBlocked = true;
      }
      if (permission == LocationPermission.denied &&
          !_permissionBlocked &&
          interactive &&
          _foreground &&
          (!_permissionAsked || retry)) {
        _permissionAsked = true;
        justRequestedPermission = true;
        permission = await Geolocator.requestPermission();
        _permissionBlocked = permission == LocationPermission.deniedForever;
        if (_granted(permission)) _permissionAsked = false;
      }

      var enabled = await _isServiceEnabled();
      // The native bridge waits for the activity if the permission popup
      // returns before the app is ready to show a second system dialog.
      final canResolve = _foreground || justRequestedPermission;
      if (!enabled &&
          _android &&
          interactive &&
          canResolve &&
          (!_resolutionOffered || retry)) {
        _resolutionOffered = true;
        final result = await _channel.invokeMethod<String>('resolve');
        // Read Android's location switch again after the resolution returns.
        enabled = await _isServiceEnabled();
        _resolutionUnavailable =
            result == 'unavailable' || (result == 'enabled' && !enabled);
      }
      if (enabled) {
        _resolutionOffered = false;
        _resolutionUnavailable = false;
      }
      if (!_granted(permission)) {
        return _permissionBlocked
            ? LocationAccessIssue.permissionBlocked
            : LocationAccessIssue.permissionDenied;
      }
      if (enabled) return null;
      return _resolutionUnavailable
          ? LocationAccessIssue.resolutionUnavailable
          : LocationAccessIssue.servicesOff;
    } on MissingPluginException {
      return LocationAccessIssue.resolutionUnavailable;
    } on Exception {
      return LocationAccessIssue.unavailable;
    }
  }

  Future<void> dispose() async {
    if (_started) WidgetsBinding.instance.removeObserver(this);
    _started = false;
    await _serviceSubscription?.cancel();
    await _pending;
    await _changes.close();
  }
}

final locationAccess = LocationAccess();
