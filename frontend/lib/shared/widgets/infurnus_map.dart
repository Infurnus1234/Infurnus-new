import 'ride_map_phase.dart';

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../core/services/map_service.dart';
import 'vehicle_motion.dart';
import '../../core/services/location_service.dart';
import '../../core/services/location_access.dart';
import '../../features/customer/data/models/route_model.dart';
import '../../features/customer/presentation/providers/ride_provider.dart';

class InfurnusMap extends ConsumerStatefulWidget {
  final String? rideStatus;
  final LatLng? pickup;
  final LatLng? destination;
  final DriverLocation? driverLocation;
  final RouteModel? route;
  final CameraPosition? initialCameraPosition;
  final double bottomOverlayHeight;

  const InfurnusMap({
    super.key,
    this.rideStatus,
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
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  late final VehicleMotion _motion;
  BitmapDescriptor? _arrow;
  Timer? _freshnessTimer;
  bool _driverStale = false;

  void _receiveDriver() {
    final fix = widget.driverLocation;
    if (fix == null) {
      if (_motion.timestamp != null) _motion.reset();
      _driverStale = false;
      return;
    }
    if (_motion.sample(
          LatLng(fix.latitude, fix.longitude),
          fix.timestamp,
          heading: fix.heading,
          speed: fix.speed,
          accuracy: fix.accuracy,
        ) &&
        !_manualCamera) {
      _mapService.animateToLocation(_motion.target!).catchError((_) {});
    }
    _driverStale =
        DateTime.now().difference(_motion.timestamp ?? fix.timestamp) >
        const Duration(seconds: 10);
  }

  late MapService _mapService;
  LatLng? _currentLocation;
  StreamSubscription? _locationSubscription;
  StreamSubscription<LocationAccessIssue?>? _accessSubscription;
  String? _locationError;
  bool _manualCamera = false;
  bool _locating = false;
  bool _locationSettingsRequired = false;
  bool _gpsSettingsRequired = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _accessSubscription = locationAccess.changes.listen((issue) {
      if (!mounted) return;
      if (issue == null) {
        unawaited(_fetchInitialLocation());
        return;
      }
      unawaited(_locationSubscription?.cancel());
      _locationSubscription = null;
      setState(() {
        _currentLocation = null;
        _locationError = issue.message;
        _locationSettingsRequired =
            issue == LocationAccessIssue.permissionBlocked;
        _gpsSettingsRequired =
            issue == LocationAccessIssue.resolutionUnavailable;
      });
    });
    _mapService = ref.read(mapServiceProvider(this));
    _motion = VehicleMotion(this);
    _arrow = cachedNavigationArrow;
    navigationArrow().then((icon) {
      if (mounted) setState(() => _arrow = icon);
    });
    _receiveDriver();
    _freshnessTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      final fix = widget.driverLocation;
      final stale =
          fix != null &&
          DateTime.now().difference(_motion.timestamp ?? fix.timestamp) >
              const Duration(seconds: 10);
      if (mounted && stale != _driverStale) {
        setState(() => _driverStale = stale);
      }
    });
    _fetchInitialLocation();
  }

  Future<void> _fetchInitialLocation({
    bool recenter = false,
    bool retry = false,
  }) async {
    if (_locating) return;
    _locating = true;
    try {
      final position = await ref
          .read(locationServiceProvider)
          .getCurrentPosition(retry: retry);
      if (position != null && mounted) {
        setState(() {
          _currentLocation = LatLng(position.latitude, position.longitude);
          _locationError = null;
          _locationSettingsRequired = false;
          _gpsSettingsRequired = false;
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
          _gpsSettingsRequired =
              error is LocationUnavailableException &&
              error.locationSettingsRequired;
        });
      }
    } finally {
      _locating = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_fetchInitialLocation());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _accessSubscription?.cancel();
    _locationSubscription?.cancel();
    _freshnessTimer?.cancel();
    _motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(mapServiceProvider(this));
    final Set<Marker> markers = {};
    final Set<Polyline> polylines = {};

    if (widget.pickup != null && !rideHasStarted(widget.rideStatus)) {
      markers.add(
        _mapService.createMarker(
          markerId: 'pickup',
          position: widget.pickup!,
          title: 'Pickup Location',
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        ),
      );
    }

    if (widget.destination != null) {
      markers.add(
        _mapService.createMarker(
          markerId: 'destination',
          position: widget.destination!,
          title: 'Destination',
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueGreen,
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
          onPointerDown: (_) {
            _manualCamera = true;
            _mapService.cancelCamera();
          },
          child: AnimatedBuilder(
            animation: _motion,
            builder: (context, _) => GoogleMap(
              padding: EdgeInsets.only(bottom: widget.bottomOverlayHeight),
              initialCameraPosition:
                  widget.initialCameraPosition ??
                  CameraPosition(target: fallbackCenter, zoom: defaultZoom),
              markers: {
                ...markers,
                if (widget.driverLocation != null &&
                    _motion.position != null &&
                    _arrow != null)
                  Marker(
                    markerId: const MarkerId('driver'),
                    position: _motion.position!,
                    flat: true,
                    anchor: const Offset(0.5, 0.5),
                    rotation: _motion.heading,
                    icon: _arrow!,
                    infoWindow: InfoWindow(
                      title: _driverStale
                          ? 'Last known driver location'
                          : 'Driver',
                    ),
                  ),
              },
              polylines: polylines,
              onMapCreated: (controller) {
                _mapService.onMapCreated(controller);
                if (widget.driverLocation != null) {
                  _mapService.animateToLocation(
                    LatLng(
                      widget.driverLocation!.latitude,
                      widget.driverLocation!.longitude,
                    ),
                  );
                } else {
                  _fitBounds();
                }
              },
              myLocationEnabled:
                  _currentLocation != null && widget.driverLocation == null,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
            ),
          ),
        ),
        if (_driverStale)
          const Positioned(
            top: 45,
            left: 8,
            right: 8,
            child: Card(
              child: Padding(
                padding: EdgeInsets.all(8),
                child: Text(
                  'Driver location is stale. Reconnecting to live updates…',
                ),
              ),
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
                        } else if (_gpsSettingsRequired) {
                          await ref
                              .read(locationServiceProvider)
                              .openLocationSettings();
                        } else {
                          await _fetchInitialLocation(retry: true);
                        }
                      },
                      child: Text(
                        _locationSettingsRequired || _gpsSettingsRequired
                            ? 'Settings'
                            : 'Retry',
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
            onPressed: () => _fetchInitialLocation(recenter: true, retry: true),
          ),
        ),
        Positioned(
          top: 70,
          right: 8,
          child: IconButton.filled(
            tooltip: 'Follow driver / fit route',
            icon: const Icon(Icons.center_focus_strong),
            onPressed: () {
              _manualCamera = false;
              if (widget.driverLocation != null) {
                _mapService.animateToLocation(
                  LatLng(
                    widget.driverLocation!.latitude,
                    widget.driverLocation!.longitude,
                  ),
                );
              } else {
                _fitBounds();
              }
            },
          ),
        ),
      ],
    );
  }

  @override
  void didUpdateWidget(InfurnusMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    _receiveDriver();
    if (widget.pickup != oldWidget.pickup ||
        widget.destination != oldWidget.destination ||
        widget.route?.encodedPolyline != oldWidget.route?.encodedPolyline ||
        widget.bottomOverlayHeight != oldWidget.bottomOverlayHeight) {
      _fitBounds();
    }
  }

  void _fitBounds() {
    if (!mounted || _manualCamera) return;
    final points = <LatLng>[];
    if (widget.pickup != null && !rideHasStarted(widget.rideStatus)) {
      points.add(widget.pickup!);
    }
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

    // GPS may resolve before GoogleMap creates its native controller. Replay
    // that fix here instead of leaving the camera at the initial fallback.
    if (points.isEmpty && _currentLocation != null) {
      points.add(_currentLocation!);
    }

    if (points.length >= 2) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_manualCamera) {
          _mapService.fitBounds(points).catchError((_) {});
        }
      });
    } else if (points.length == 1) {
      // Unlike fitting bounds, centering one point does not depend on another
      // layout pass. A late native-map callback may have no further frame queued.
      _mapService.animateToLocation(points.first).catchError((_) {});
    }
  }
}
