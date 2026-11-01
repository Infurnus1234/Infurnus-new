import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';

class RecordingMaps extends MethodChannelGoogleMapsFlutter {
  RecordingMaps({this.deferCreation = false});
  final bool deferCreation;
  final pendingCreations = <VoidCallback>[];
  void completeCreation() {
    for (final create in pendingCreations.toList()) {
      create();
    }
    pendingCreations.clear();
  }

  final calls = <MethodCall>[];
  final created = <int>{};
  @override
  Widget buildViewWithConfiguration(
    int creationId,
    PlatformViewCreatedCallback onPlatformViewCreated, {
    required MapWidgetConfiguration widgetConfiguration,
    MapConfiguration mapConfiguration = const MapConfiguration(),
    MapObjects mapObjects = const MapObjects(),
  }) {
    if (created.add(creationId)) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            MethodChannel('plugins.flutter.io/google_maps_$creationId'),
            (call) async {
              calls.add(call);
              return null;
            },
          );
      if (deferCreation) {
        pendingCreations.add(() => onPlatformViewCreated(creationId));
      } else {
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => onPlatformViewCreated(creationId),
        );
      }
    }
    return const ColoredBox(color: Colors.grey, key: Key('recording-map'));
  }

  @override
  Future<void> updateGroundOverlays(
    GroundOverlayUpdates updates, {
    required int mapId,
  }) async {}
  int get cameraCalls =>
      calls.where((c) => c.method == 'camera#animate').length;
}
