import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

/// Interpolates real samples only; never extrapolates past a received fix.
class VehicleMotion extends ChangeNotifier {
  VehicleMotion(TickerProvider vsync) {
    animation = AnimationController(
      vsync: vsync,
      duration: const Duration(milliseconds: 950),
    )..addListener(notifyListeners);
  }
  late final AnimationController animation;
  LatLng? _from, _to;
  double _fromHeading = 0, _toHeading = 0;
  DateTime? timestamp;
  LatLng? get position {
    if (_to == null || _from == null) return _to;
    final t = animation.value;
    final lng = ((_to!.longitude - _from!.longitude + 540) % 360) - 180;
    return LatLng(
      _from!.latitude + (_to!.latitude - _from!.latitude) * t,
      ((_from!.longitude + lng * t + 540) % 360) - 180,
    );
  }

  double get heading =>
      (_fromHeading +
          (((_toHeading - _fromHeading + 540) % 360) - 180) * animation.value +
          360) %
      360;
  bool sample(
    LatLng next,
    DateTime time, {
    double? heading,
    double? speed,
    double? accuracy,
  }) {
    if (!next.latitude.isFinite ||
        !next.longitude.isFinite ||
        (accuracy != null && (!accuracy.isFinite || accuracy > 200)) ||
        (timestamp != null && !time.isAfter(timestamp!))) {
      return false;
    }
    final previous = _to;
    final elapsed = timestamp == null
        ? 1000
        : time.difference(timestamp!).inMilliseconds;
    if (previous != null &&
        distance(previous, next) >
            elapsed / 1000 * 75 + (accuracy ?? 0) + 100) {
      return false;
    }
    if (previous != null &&
        (speed ?? 0) < 1.5 &&
        distance(previous, next) < math.max(3, (accuracy ?? 0) * 0.4)) {
      next = previous;
    }
    _from = position ?? next;
    _fromHeading = this.heading;
    if (heading != null &&
        heading.isFinite &&
        heading >= 0 &&
        heading <= 360 &&
        (speed ?? 0) >= 1.5 &&
        (accuracy ?? 0) <= 50) {
      _toHeading = heading % 360;
    } else if (previous != null &&
        distance(previous, next) > math.max(8, accuracy ?? 0) &&
        (speed == null || speed >= 1.5)) {
      final lat1 = previous.latitude * math.pi / 180,
          lat2 = next.latitude * math.pi / 180;
      final dl = (next.longitude - previous.longitude) * math.pi / 180;
      _toHeading =
          (math.atan2(
                    math.sin(dl) * math.cos(lat2),
                    math.cos(lat1) * math.sin(lat2) -
                        math.sin(lat1) * math.cos(lat2) * math.cos(dl),
                  ) *
                  180 /
                  math.pi +
              360) %
          360;
    }
    _to = next;
    timestamp = time;
    animation.duration = Duration(milliseconds: elapsed.clamp(300, 1500));
    animation.forward(from: 0);
    return true;
  }

  void reset() {
    animation.stop();
    _from = null;
    _to = null;
    timestamp = null;
    _fromHeading = 0;
    _toHeading = 0;
    notifyListeners();
  }

  static double deviation(LatLng point, List<LatLng> route) {
    var best = double.infinity;
    for (var i = 1; i < route.length; i++) {
      final a = route[i - 1], b = route[i];
      final scale = math.cos(point.latitude * math.pi / 180);
      final dx = (b.longitude - a.longitude) * scale;
      final dy = b.latitude - a.latitude;
      final px = (point.longitude - a.longitude) * scale;
      final py = point.latitude - a.latitude;
      final length = dx * dx + dy * dy;
      final t = length == 0
          ? 0.0
          : ((px * dx + py * dy) / length).clamp(0.0, 1.0);
      best = math.min(
        best,
        math.sqrt(math.pow(px - dx * t, 2) + math.pow(py - dy * t, 2)) * 111320,
      );
    }
    return best;
  }

  static double distance(LatLng a, LatLng b) {
    final dy = (b.latitude - a.latitude) * 111320;
    final dx =
        (b.longitude - a.longitude) *
        111320 *
        math.cos(a.latitude * math.pi / 180);
    return math.sqrt(dx * dx + dy * dy);
  }

  @override
  void dispose() {
    animation.dispose();
    super.dispose();
  }
}

/// North-facing bitmap; flat markers rotate in geographic map coordinates.
Future<BitmapDescriptor> navigationArrow() async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final path = Path()
    ..moveTo(32, 4)
    ..lineTo(55, 57)
    ..lineTo(32, 46)
    ..lineTo(9, 57)
    ..close();
  canvas.drawPath(
    path,
    Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 7
      ..strokeJoin = StrokeJoin.round,
  );
  canvas.drawPath(path, Paint()..color = const Color(0xff1769e0));
  final picture = recorder.endRecording();
  final image = await picture.toImage(64, 64);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return BitmapDescriptor.bytes(
    bytes!.buffer.asUint8List(),
    width: 40,
    height: 40,
  );
}
