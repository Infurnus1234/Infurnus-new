import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../core/services/map_service.dart';
import '../../core/services/location_service.dart';
import '../../features/customer/data/models/route_model.dart';
import '../../features/customer/presentation/providers/ride_provider.dart';

class InfurnusMap extends ConsumerStatefulWidget {
  final LatLng? pickup;
  final LatLng? destination;
  final DriverLocation? driverLocation;
  final RouteModel? route;
  final CameraPosition? initialCameraPosition;
  final double bottomOverlayHeight;

  const InfurnusMap({
    super.key,
    this.pickup,
    this.destination,
    this.driverLocation,
    this.route,
    this.initialCameraPosition,
    this.bottomOverlayHeight = 0,
  });

  @override
  ConsumerState<InfurnusMap> createState() => _InfurnusMapState();
}

class _InfurnusMapState extends ConsumerState<InfurnusMap>
    with WidgetsBindingObserver {
  late MapService _mapService;
  LatLng? _currentLocation;
  StreamSubscription? _locationSubscription;
  String? _locationError;
  bool _manualCamera = false;
  bool _locating = false;
  bool _locationSettingsRequired = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _mapService = ref.read(mapServiceProvider(this));
    _fetchInitialLocation();
  }

  Future<void> _fetchInitialLocation({bool recenter = false}) async {
    if (_locating) return;
    _locating = true;
    try {
      final position = await ref
          .read(locationServiceProvider)
          .getCurrentPosition();
      if (position != null && mounted) {
        setState(() {
          _currentLocation = LatLng(position.latitude, position.longitude);
          _locationError = null;
          _locationSettingsRequired = false;
        });
        if (recenter ||
            (widget.pickup == null &&
                widget.destination == null &&
                !_manualCamera)) {
          if (recenter) _manualCamera = true;
          await _mapService.animateToLocation(_currentLocation!);
        }
        if (!mounted) return;
        await _locationSubscription?.cancel();
        if (!mounted) return;
        _locationSubscription = ref
            .read(locationServiceProvider)
            .getPositionStream()
            .listen(
              (position) {
                if (!mounted) return;
                setState(() {
                  _locationError = null;
                  _currentLocation = LatLng(
                    position.latitude,
                    position.longitude,
                  );
                });
              },
              onError: (_) {
                if (mounted) {
                  setState(
                    () => _locationError =
                        'Live location unavailable; showing last location.',
                  );
                }
              },
            );
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _locationError = error.toString();
          _locationSettingsRequired =
              error is LocationUnavailableException && error.settingsRequired;
        });
      }
    } finally {
      _locating = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _fetchInitialLocation();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _locationSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(mapServiceProvider(this));
    final Set<Marker> markers = {};
    final Set<Polyline> polylines = {};
    if (_currentLocation != null) {
      markers.add(
        _mapService.createMarker(
          markerId: 'current',
          position: _currentLocation!,
          title: 'Your location',
        ),
      );
    }

    if (widget.pickup != null) {
      markers.add(
        _mapService.createMarker(
          markerId: 'pickup',
          position: widget.pickup!,
          title: 'Pickup Location',
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueGreen,
          ),
        ),
      );
    }

    if (widget.destination != null) {
      markers.add(
        _mapService.createMarker(
          markerId: 'destination',
          position: widget.destination!,
          title: 'Destination',
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        ),
      );
    }

    if (widget.driverLocation != null) {
      markers.add(
        _mapService.createMarker(
          markerId: 'driver',
          position: LatLng(
            widget.driverLocation!.latitude,
            widget.driverLocation!.longitude,
          ),
          title: 'Driver',
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueAzure,
          ),
        ),
      );
    }

    if (widget.route?.encodedPolyline != null) {
      final polyline = _mapService.createPolyline(
        polylineId: 'route',
        encodedPolyline: widget.route!.encodedPolyline!,
      );
      if (polyline != null) {
        polylines.add(polyline);
      }
    }

    // Determine center for the fallback camera position
    final LatLng fallbackCenter =
        widget.pickup ??
        widget.destination ??
        _currentLocation ??
        const LatLng(25.6, 85.8);
    final double defaultZoom =
        (widget.pickup != null ||
            widget.destination != null ||
            _currentLocation != null)
        ? 14.0
        : 7.0;

    return Stack(
      fit: StackFit.expand,
      children: [
        Listener(
          onPointerDown: (_) => _manualCamera = true,
          child: GoogleMap(
            padding: EdgeInsets.only(bottom: widget.bottomOverlayHeight),
            initialCameraPosition:
                widget.initialCameraPosition ??
                CameraPosition(target: fallbackCenter, zoom: defaultZoom),
            markers: markers,
            polylines: polylines,
            onMapCreated: (controller) {
              _mapService.onMapCreated(controller);
              _fitBounds();
            },
            myLocationEnabled: _currentLocation != null,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
            mapToolbarEnabled: false,
          ),
        ),
        if (_locationError != null)
          Positioned(
            top: 8,
            left: 8,
            right: 8,
            child: Material(
              color: Theme.of(context).colorScheme.surface,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Row(
                  children: [
                    Expanded(child: Text(_locationError!)),
                    TextButton(
                      onPressed: () async {
                        if (_locationSettingsRequired) {
                          await ref
                              .read(locationServiceProvider)
                              .openAppSettings();
                        } else {
                          await _fetchInitialLocation();
                        }
                      },
                      child: Text(
                        _locationSettingsRequired ? 'Settings' : 'Retry',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        Positioned(
          top: 120,
          right: 8,
          child: IconButton.filled(
            tooltip: 'Show current location',
            icon: const Icon(Icons.my_location),
            onPressed: () => _fetchInitialLocation(recenter: true),
          ),
        ),
        Positioned(
          top: 70,
          right: 8,
          child: IconButton.filled(
            tooltip: 'Fit ride route',
            icon: const Icon(Icons.center_focus_strong),
            onPressed: () {
              _manualCamera = false;
              _fitBounds();
            },
          ),
        ),
      ],
    );
  }

  @override
  void didUpdateWidget(InfurnusMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.pickup != oldWidget.pickup ||
        widget.destination != oldWidget.destination ||
        widget.route != oldWidget.route ||
        widget.bottomOverlayHeight != oldWidget.bottomOverlayHeight) {
      _fitBounds();
    }
  }

  void _fitBounds() {
    if (!mounted || _manualCamera) return;
    final points = <LatLng>[];
    if (widget.pickup != null) points.add(widget.pickup!);
    if (widget.destination != null) points.add(widget.destination!);
    final encoded = widget.route?.encodedPolyline;
    if (encoded != null) {
      final polyline = _mapService.createPolyline(
        polylineId: 'bounds',
        encodedPolyline: encoded,
      );
      if (polyline != null) points.addAll(polyline.points);
    }
    if (widget.driverLocation != null) {
      points.add(
        LatLng(
          widget.driverLocation!.latitude,
          widget.driverLocation!.longitude,
        ),
      );
    }

    if (points.length >= 2) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_manualCamera) {
          _mapService.fitBounds(points).catchError((_) {});
        }
      });
    } else if (points.length == 1) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_manualCamera) {
          _mapService.animateToLocation(points.first).catchError((_) {});
        }
      });
    }
  }
}
