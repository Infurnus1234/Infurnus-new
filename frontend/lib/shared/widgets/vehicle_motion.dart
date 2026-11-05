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
  LatLng? _from, _to, _courseOrigin;
  DateTime? _courseTime;
  double _fromHeading = 0, _toHeading = 0;
  bool _hasHeading = false;
  DateTime? timestamp;
  LatLng? get target => _to;
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
    final origin = _courseOrigin ?? previous;
    final movement = origin == null ? 0.0 : distance(origin, next);
    final courseSeconds = _courseTime == null
        ? elapsed / 1000
        : time.difference(_courseTime!).inMilliseconds / 1000;
    final measuredSpeed = courseSeconds <= 0 ? 0.0 : movement / courseSeconds;
    final moving =
        (speed ?? 0) >= 1.5 ||
        (measuredSpeed >= 1.5 && movement > math.max(8, (accuracy ?? 0) * 2));
    final reliableCourse =
        origin != null &&
        moving &&
        movement > math.max(8, (accuracy ?? 0) * 2) &&
        (accuracy ?? 0) <= 50;
    final validHeading =
        heading != null &&
        heading.isFinite &&
        heading >= 0 &&
        heading <= 360 &&
        moving &&
        (accuracy ?? 0) <= 50;
    if (reliableCourse) {
      final course = bearing(origin, next);
      // GPS displacement independently checks reported course. A device/mock
      // heading pointing behind real movement must not reverse the arrow.
      final mismatch = validHeading
          ? (((heading - course + 540) % 360) - 180).abs()
          : 180.0;
      _toHeading = validHeading && mismatch <= 90 ? heading % 360 : course;
      _hasHeading = true;
    } else if (validHeading) {
      final turn = (((heading - _toHeading + 540) % 360) - 180).abs();
      // Without enough displacement, a reversal is not reliable evidence of a
      // turn. Preserve the last course until motion confirms it.
      if (!_hasHeading || turn < 120) {
        _toHeading = heading % 360;
        _hasHeading = true;
      }
    }
    if (_courseOrigin == null || reliableCourse || (accuracy ?? 0) > 50) {
      _courseOrigin = next;
      _courseTime = time;
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
    _courseOrigin = null;
    _courseTime = null;
    timestamp = null;
    _fromHeading = 0;
    _toHeading = 0;
    _hasHeading = false;
    notifyListeners();
  }

  /// Geographic course: north=0, east=90; independent of camera bearing.
  static double bearing(LatLng from, LatLng to) {
    final a = from.latitude * math.pi / 180;
    final b = to.latitude * math.pi / 180;
    final dl =
        (((to.longitude - from.longitude + 540) % 360) - 180) * math.pi / 180;
    return (math.atan2(
                  math.sin(dl) * math.cos(b),
                  math.cos(a) * math.sin(b) -
                      math.sin(a) * math.cos(b) * math.cos(dl),
                ) *
                180 /
                math.pi +
            360) %
        360;
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
        ((((b.longitude - a.longitude) + 540) % 360) - 180) *
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
BitmapDescriptor? _arrowDescriptor;
BitmapDescriptor? get cachedNavigationArrow => _arrowDescriptor;
Future<BitmapDescriptor>? _cachedArrow;
Future<BitmapDescriptor> navigationArrow() =>
    _cachedArrow ??= _renderNavigationArrow();

Future<BitmapDescriptor> _renderNavigationArrow() async {
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
  return _arrowDescriptor = BitmapDescriptor.bytes(
    bytes!.buffer.asUint8List(),
    width: 40,
    height: 40,
  );
}
