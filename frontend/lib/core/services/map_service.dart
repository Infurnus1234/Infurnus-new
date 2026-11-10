import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../utils/polyline_decoder.dart';
import '../../shared/widgets/map_camera_queue.dart';

abstract class MapService {
  void onMapCreated(GoogleMapController controller);
  void dispose();
  void cancelCamera();

  Future<void> animateToLocation(LatLng position, {double zoom = 15.0});
  Future<void> fitBounds(List<LatLng> points, {double padding = 50.0});

  Marker createMarker({
    required String markerId,
    required LatLng position,
    BitmapDescriptor icon = BitmapDescriptor.defaultMarker,
    String? title,
    String? snippet,
  });

  Polyline? createPolyline({
    required String polylineId,
    required String encodedPolyline,
    Color color = Colors.blue,
    int width = 5,
  });

  LatLngBounds boundsFromLatLngList(List<LatLng> list);
}

class GoogleMapServiceImpl implements MapService {
  GoogleMapController? _controller;
  final _camera = MapCameraQueue();
  String? _encoded;
  List<LatLng> _points = const [];

  @override
  void onMapCreated(GoogleMapController controller) {
    _controller = controller;
    _camera.controller = controller;
  }

  @override
  void cancelCamera() => _camera.cancel();

  @override
  void dispose() {
    // GoogleMap owns/disposes its platform controller.
    _camera.dispose();
    _controller = null;
  }

  @override
  Future<void> animateToLocation(LatLng position, {double zoom = 15.0}) async {
    _camera.move(CameraUpdate.newLatLngZoom(position, zoom));
  }

  @override
  Future<void> fitBounds(List<LatLng> points, {double padding = 50.0}) async {
    if (points.isEmpty || _controller == null) return;

    final bounds = boundsFromLatLngList(points);
    _camera.move(CameraUpdate.newLatLngBounds(bounds, padding));
  }

  @override
  Marker createMarker({
    required String markerId,
    required LatLng position,
    BitmapDescriptor icon = BitmapDescriptor.defaultMarker,
    String? title,
    String? snippet,
  }) {
    return Marker(
      markerId: MarkerId(markerId),
      position: position,
      icon: icon,
      infoWindow: title != null
          ? InfoWindow(title: title, snippet: snippet)
          : InfoWindow.noText,
    );
  }

  @override
  Polyline? createPolyline({
    required String polylineId,
    required String encodedPolyline,
    Color color = Colors.blue,
    int width = 5,
  }) {
    if (_encoded != encodedPolyline) {
      _points = PolylineDecoder.decode(encodedPolyline);
      _encoded = encodedPolyline;
    }
    final points = _points;
    if (points.isEmpty) return null;

    return Polyline(
      polylineId: PolylineId(polylineId),
      points: points,
      color: color,
      width: width,
      jointType: JointType.round,
      startCap: Cap.roundCap,
      endCap: Cap.roundCap,
    );
  }

  @override
  LatLngBounds boundsFromLatLngList(List<LatLng> list) {
    double? minLat, maxLat, minLng, maxLng;

    for (final latLng in list) {
      if (minLat == null || latLng.latitude < minLat) minLat = latLng.latitude;
      if (maxLat == null || latLng.latitude > maxLat) maxLat = latLng.latitude;
      if (minLng == null || latLng.longitude < minLng) {
        minLng = latLng.longitude;
      }
      if (maxLng == null || latLng.longitude > maxLng) {
        maxLng = latLng.longitude;
      }
    }

    return LatLngBounds(
      southwest: LatLng(minLat!, minLng!),
      northeast: LatLng(maxLat!, maxLng!),
    );
  }
}

final mapServiceProvider = Provider.autoDispose.family<MapService, Object>((
  ref,
  owner,
) {
  final service = GoogleMapServiceImpl();
  ref.onDispose(service.dispose);
  return service;
});
