import 'dart:async';

import 'package:google_maps_flutter/google_maps_flutter.dart';

/// Latest-wins camera requests, paced independently of GPS collection.
class MapCameraQueue {
  GoogleMapController? controller;
  CameraUpdate? _pending;
  Timer? _cooldown;
  bool _disposed = false;

  void move(CameraUpdate update) {
    if (_disposed || controller == null) return;
    _pending = update;
    if (_cooldown == null) _flush();
  }

  void _flush() {
    final update = _pending;
    _pending = null;
    if (_disposed || update == null || controller == null) return;
    // Platform futures acknowledge dispatch, not native animation completion.
    _cooldown = Timer(const Duration(milliseconds: 1000), () {
      _cooldown = null;
      _flush();
    });
    controller!.animateCamera(update).catchError((_) {});
  }

  void cancel() {
    _pending = null;
  }

  void dispose() {
    _disposed = true;
    _pending = null;
    _cooldown?.cancel();
    controller = null;
  }
}
