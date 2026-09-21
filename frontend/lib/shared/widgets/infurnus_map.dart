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

  const InfurnusMap({
    super.key,
    this.pickup,
    this.destination,
    this.driverLocation,
    this.route,
    this.initialCameraPosition,
  });

  @override
  ConsumerState<InfurnusMap> createState() => _InfurnusMapState();
}

class _InfurnusMapState extends ConsumerState<InfurnusMap> {
  late MapService _mapService;
  LatLng? _currentLocation;

  @override
  void initState() {
    super.initState();
    _mapService = ref.read(mapServiceProvider);
    _fetchInitialLocation();
  }

  Future<void> _fetchInitialLocation() async {
    // Only fetch current location if we don't have ride-specific coordinates
    if (widget.pickup == null && widget.destination == null) {
      final position = await ref
          .read(locationServiceProvider)
          .getCurrentPosition();
      if (position != null && mounted) {
        setState(() {
          _currentLocation = LatLng(position.latitude, position.longitude);
        });
        _mapService.animateToLocation(_currentLocation!);
      }
    }
  }

  @override
  void dispose() {
    _mapService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final Set<Marker> markers = {};
    final Set<Polyline> polylines = {};

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
        widget.pickup ?? _currentLocation ?? const LatLng(20.5937, 78.9629);
    final double defaultZoom =
        (widget.pickup != null || _currentLocation != null) ? 14.0 : 5.0;

    return GoogleMap(
      initialCameraPosition:
          widget.initialCameraPosition ??
          CameraPosition(target: fallbackCenter, zoom: defaultZoom),
      markers: markers,
      polylines: polylines,
      onMapCreated: (controller) {
        _mapService.onMapCreated(controller);
        _fitBounds();
      },
      myLocationEnabled: true,
      myLocationButtonEnabled: false,
      zoomControlsEnabled: false,
      mapToolbarEnabled: false,
    );
  }

  @override
  void didUpdateWidget(InfurnusMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.pickup != oldWidget.pickup ||
        widget.destination != oldWidget.destination ||
        widget.route != oldWidget.route) {
      _fitBounds();
    }
  }

  void _fitBounds() {
    final points = <LatLng>[];
    if (widget.pickup != null) points.add(widget.pickup!);
    if (widget.destination != null) points.add(widget.destination!);
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
        _mapService.fitBounds(points);
      });
    } else if (points.length == 1) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _mapService.animateToLocation(points.first);
      });
    }
  }
}
