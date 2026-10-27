import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../../core/services/location_service.dart';
import '../../../../shared/widgets/route_distance_summary.dart';
import '../../../../core/services/geocoding_service.dart';
import '../../../../core/services/places_autocomplete_service.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_map.dart';
import '../../../../shared/widgets/infurnus_outlined_button.dart';
import '../../data/models/fleet_vehicle_model.dart';
import '../providers/ride_provider.dart';
import '../widgets/fare_range_details.dart';
import '../widgets/waiting_timer_widget.dart';
import '../providers/ride_use_case_providers.dart';
import '../../domain/utils/passenger_vehicle_filter.dart';

class RideBookingScreen extends ConsumerStatefulWidget {
  const RideBookingScreen({super.key});

  @override
  ConsumerState<RideBookingScreen> createState() => _RideBookingScreenState();
}

class _RideBookingScreenState extends ConsumerState<RideBookingScreen>
    with WidgetsBindingObserver {
  static const Color mainBg = Color(0xFFF9FAFB);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color cardElevated = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE5E7EB);
  static const Color textWhite = Color(0xFF111827);
  static const Color textGray = Color(0xFF4B5563);
  static const Color brandGreen = Color(0xFF16A34A);
  static const Color serviceRed = Color(0xFFDC2626);
  static const Color premiumBlue = Color(0xFF2563EB);
  static const Color goldAccent = Color(0xFFCA8A04);

  final _pickupController = TextEditingController();
  final _destinationController = TextEditingController();
  final _reviewController = TextEditingController();
  final _serviceNotesController = TextEditingController();
  Timer? _pickupAutocompleteTimer;
  Timer? _destinationAutocompleteTimer;
  CancelToken? _pickupAutocompleteToken;
  CancelToken? _destinationAutocompleteToken;
  List<PlaceSuggestion> _pickupSuggestions = [];
  List<PlaceSuggestion> _destinationSuggestions = [];
  String? _pickupSearchError;
  String? _destinationSearchError;
  bool _isLoadingPickupSuggestions = false;
  bool _isLoadingDestinationSuggestions = false;
  bool? _activeAutocompleteIsPickup;
  int _selectedRating = 5;
  String _selectedPaymentMethod = 'wallet';
  bool _isProcessingPayment = false;
  bool _isSubmittingBooking = false;
  // ignore: unused_field
  bool _isLoadingFleet = true;
  List<FleetVehicleModel> _fleetVehicles = [];
  CancelToken _fleetCancelToken = CancelToken();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final rideState = ref.read(rideProvider);
    _pickupController.text = rideState.pickup ?? '';
    _destinationController.text = rideState.destination ?? '';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _detectCurrentLocation(preserveSelection: true);
      _fetchFleet(rideState.selectedSector);
      if (rideState.pickupCoords != null &&
          rideState.destinationCoords != null) {
        ref.read(rideProvider.notifier).estimateRouteFare();
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || !mounted) return;
    final rideId = ref.read(rideProvider).currentRide?.id;
    if (rideId != null) {
      unawaited(ref.read(rideProvider.notifier).getRideDetails(rideId));
    }
  }

  Future<void> _fetchFleet(String sector) async {
    _fleetCancelToken.cancel();
    _fleetCancelToken = CancelToken();
    final cancelToken = _fleetCancelToken;
    if (mounted) setState(() => _isLoadingFleet = true);
    try {
      final rawFleet = await ref
          .read(getFleetUseCaseProvider)
          .call(sector: sector);
      if (cancelToken.isCancelled) return;
      final fleet = sector == 'passenger'
          ? rawFleet
                .where(
                  (v) => !isExcludedPassengerVehicle(v.category, v.displayName),
                )
                .toList()
          : rawFleet;
      if (mounted) {
        setState(() {
          _fleetVehicles = fleet;
          _isLoadingFleet = false;
        });
        final rideState = ref.read(rideProvider);
        if (rideState.selectedTier.isEmpty) {
          final nextTier = fleet.isNotEmpty
              ? fleet.first.category
              : (_getVehiclesForSector(sector).isNotEmpty
                    ? _getVehiclesForSector(sector).first['category'] as String
                    : 'hatchback');
          ref.read(rideProvider.notifier).selectTier(nextTier);
        }
      }
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) return;
      if (mounted) {
        setState(() => _isLoadingFleet = false);
        debugPrint('Fleet fetch fallback to catalog: $e');
        final rideState = ref.read(rideProvider);
        if (rideState.selectedTier.isEmpty) {
          final catalog = _getVehiclesForSector(sector);
          if (catalog.isNotEmpty) {
            ref
                .read(rideProvider.notifier)
                .selectTier(catalog.first['category'] as String);
          }
        }
      }
    } catch (error) {
      if (mounted) {
        setState(() => _isLoadingFleet = false);
        debugPrint('Fleet fetch fallback to catalog: $error');
        final rideState = ref.read(rideProvider);
        if (rideState.selectedTier.isEmpty) {
          final catalog = _getVehiclesForSector(sector);
          if (catalog.isNotEmpty) {
            ref
                .read(rideProvider.notifier)
                .selectTier(catalog.first['category'] as String);
          }
        }
      }
    }
  }

  void _onLocationQueryChanged(String query, {required bool isPickup}) {
    final controller = isPickup ? _pickupController : _destinationController;
    final previousTimer = isPickup
        ? _pickupAutocompleteTimer
        : _destinationAutocompleteTimer;
    final previousToken = isPickup
        ? _pickupAutocompleteToken
        : _destinationAutocompleteToken;
    previousTimer?.cancel();
    previousToken?.cancel();

    if (isPickup) {
      _pickupSearchError = null;
      ref.read(rideProvider.notifier).updatePickupAddress(query);
    } else {
      _destinationSearchError = null;
      ref.read(rideProvider.notifier).updateDestinationAddress(query);
    }

    if (query.trim().isEmpty) {
      setState(() {
        _activeAutocompleteIsPickup = null;
        _pickupSuggestions = [];
        _destinationSuggestions = [];
        _isLoadingPickupSuggestions = false;
        _isLoadingDestinationSuggestions = false;
      });
      return;
    }

    setState(() {
      _activeAutocompleteIsPickup = isPickup;
      if (isPickup) {
        _pickupSuggestions = [];
        _isLoadingPickupSuggestions = true;
      } else {
        _destinationSuggestions = [];
        _isLoadingDestinationSuggestions = true;
      }
    });

    final cancelToken = CancelToken();
    if (isPickup) {
      _pickupAutocompleteToken = cancelToken;
    } else {
      _destinationAutocompleteToken = cancelToken;
    }

    final timer = Timer(const Duration(milliseconds: 250), () async {
      try {
        final suggestions = await ref
            .read(placesAutocompleteServiceProvider)
            .getSuggestions(query, cancelToken: cancelToken);
        if (!mounted ||
            cancelToken.isCancelled ||
            controller.text.trim() != query.trim()) {
          return;
        }
        setState(() {
          if (isPickup) {
            _pickupSuggestions = suggestions;
            _isLoadingPickupSuggestions = false;
          } else {
            _destinationSuggestions = suggestions;
            _isLoadingDestinationSuggestions = false;
          }
        });
      } catch (error) {
        if (mounted && !cancelToken.isCancelled) {
          setState(() {
            if (isPickup) {
              _pickupSuggestions = [];
              _pickupSearchError = locationSearchErrorMessage(error);
              _isLoadingPickupSuggestions = false;
            } else {
              _destinationSuggestions = [];
              _destinationSearchError = locationSearchErrorMessage(error);
              _isLoadingDestinationSuggestions = false;
            }
          });
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(locationSearchErrorMessage(error))),
          );
        }
      }
    });
    if (isPickup) {
      _pickupAutocompleteTimer = timer;
    } else {
      _destinationAutocompleteTimer = timer;
    }
  }

  Future<void> _selectLocationSuggestion(
    PlaceSuggestion suggestion, {
    required bool isPickup,
  }) async {
    final controller = isPickup ? _pickupController : _destinationController;
    final selectedQuery = controller.text;
    LatLng? resolved;
    try {
      resolved = suggestion.latitude != null && suggestion.longitude != null
          ? LatLng(suggestion.latitude!, suggestion.longitude!)
          : await ref
                .read(geocodingServiceProvider)
                .geocodeAddress(suggestion.toString());
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to resolve this location. Please retry.'),
          ),
        );
      }
      return;
    }
    if (!mounted || controller.text != selectedQuery) return;
    if (resolved == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Selected location could not be resolved.'),
        ),
      );
      return;
    }

    final timer = isPickup
        ? _pickupAutocompleteTimer
        : _destinationAutocompleteTimer;
    final token = isPickup
        ? _pickupAutocompleteToken
        : _destinationAutocompleteToken;
    timer?.cancel();
    token?.cancel();

    final address = suggestion.toString();
    setState(() {
      _activeAutocompleteIsPickup = null;
      if (isPickup) {
        _pickupController.text = address;
        _pickupSuggestions = [];
        _isLoadingPickupSuggestions = false;
      } else {
        _destinationController.text = address;
        _destinationSuggestions = [];
        _isLoadingDestinationSuggestions = false;
      }
    });

    final coordinates = resolved;
    if (isPickup) {
      ref
          .read(rideProvider.notifier)
          .setPickupCoords(coordinates, address: address);
    } else {
      ref
          .read(rideProvider.notifier)
          .setDestinationCoords(coordinates, address: address);
    }
  }

  Widget _buildLocationSuggestions({required bool isPickup}) {
    if (_activeAutocompleteIsPickup != isPickup) return const SizedBox.shrink();

    final suggestions = isPickup ? _pickupSuggestions : _destinationSuggestions;
    final isLoading = isPickup
        ? _isLoadingPickupSuggestions
        : _isLoadingDestinationSuggestions;

    return Container(
      margin: const EdgeInsets.only(top: 6, bottom: 8),
      decoration: BoxDecoration(
        color: cardBg,
        border: Border.all(color: borderCard),
        borderRadius: BorderRadius.circular(8),
      ),
      child: isLoading
          ? const Padding(
              padding: EdgeInsets.all(14),
              child: Center(
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          : suggestions.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(14),
              child: Text(
                (isPickup ? _pickupSearchError : _destinationSearchError) ??
                    'No matching locations found',
                style: const TextStyle(color: textGray, fontSize: 13),
              ),
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final suggestion in suggestions)
                  ListTile(
                    dense: true,
                    leading: const Icon(
                      Icons.location_on_outlined,
                      color: brandGreen,
                    ),
                    title: Text(
                      suggestion.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: textWhite),
                    ),
                    subtitle: Text(
                      suggestion.subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: textGray),
                    ),
                    onTap: () => _selectLocationSuggestion(
                      suggestion,
                      isPickup: isPickup,
                    ),
                  ),
              ],
            ),
    );
  }

  Future<void> _detectCurrentLocation({bool preserveSelection = false}) async {
    try {
      final currentPickup = _pickupController.text.trim();
      if (preserveSelection &&
          currentPickup.isNotEmpty &&
          currentPickup.toLowerCase() != 'current location') {
        return;
      }
      final pos = await ref.read(locationServiceProvider).getCurrentPosition();
      if (pos != null && mounted) {
        if (preserveSelection &&
            _pickupController.text.trim() != currentPickup) {
          return;
        }
        _pickupController.text = 'Current Location';
        ref
            .read(rideProvider.notifier)
            .setPickupCoords(
              LatLng(pos.latitude, pos.longitude),
              address: 'Current Location',
            );
        unawaited(_reverseGeocodePickup(LatLng(pos.latitude, pos.longitude)));
      }
    } catch (_) {}
  }

  Future<void> _reverseGeocodePickup(LatLng coordinates) async {
    final address = await ref
        .read(geocodingServiceProvider)
        .reverseGeocode(coordinates);
    if (!mounted || address == null) return;

    final pickupCoords = ref.read(rideProvider).pickupCoords;
    if (pickupCoords == null ||
        pickupCoords.latitude != coordinates.latitude ||
        pickupCoords.longitude != coordinates.longitude) {
      return;
    }

    if (_pickupController.text.trim().toLowerCase() == 'current location') {
      _pickupController.text = address;
    }
    ref.read(rideProvider.notifier).setPickupAddress(address);
  }

  @override
  void dispose() {
    _fleetCancelToken.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _pickupController.dispose();
    _destinationController.dispose();
    _pickupAutocompleteTimer?.cancel();
    _destinationAutocompleteTimer?.cancel();
    _pickupAutocompleteToken?.cancel();
    _destinationAutocompleteToken?.cancel();
    _reviewController.dispose();
    _serviceNotesController.dispose();
    super.dispose();
  }

  void _handleBooking() async {
    if (_isSubmittingBooking) return;

    final initialRideState = ref.read(rideProvider);
    if (_isUnsupportedVehicle(initialRideState)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Bike, Auto, and E-Rickshaw are not available. Please select a valid passenger vehicle.',
          ),
          backgroundColor: serviceRed,
        ),
      );
      _showVehicleSelectionBottomSheet(initialRideState);
      return;
    }

    final pickupText = _pickupController.text.trim();
    final destText = _destinationController.text.trim();

    if (pickupText.isEmpty || destText.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter pickup and destination')),
      );
      return;
    }

    setState(() => _isSubmittingBooking = true);

    try {
      final rideState = ref.read(rideProvider);
      if (rideState.pickupCoords == null) {
        final success = await ref
            .read(rideProvider.notifier)
            .geocodeAndSetPickup(pickupText);
        if (!success && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Could not locate pickup "$pickupText". Please check the address.',
              ),
              backgroundColor: serviceRed,
            ),
          );
          return;
        }
      }

      if (ref.read(rideProvider).destinationCoords == null) {
        final success = await ref
            .read(rideProvider.notifier)
            .geocodeAndSetDestination(destText);
        if (!success && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Could not locate destination "$destText". Please check the address.',
              ),
              backgroundColor: serviceRed,
            ),
          );
          return;
        }
      }

      await ref.read(rideProvider.notifier).requestRide();
    } finally {
      if (mounted) {
        setState(() => _isSubmittingBooking = false);
      }
    }
  }

  String _getFuelNoticeText(RideState state) {
    final rentalFuelRate = state.rentalDetails?['fuelRatePerKm'] as num?;
    if (rentalFuelRate != null && rentalFuelRate > 0) {
      return 'Actual distance fuel billed separately @ ₹${rentalFuelRate.toStringAsFixed(0)}/km';
    }
    final vehicle = _fleetVehicles
        .where((v) => v.category == state.selectedTier)
        .firstOrNull;
    if (vehicle != null && vehicle.fuelRatePerKm > 0) {
      return 'Actual distance fuel billed separately @ ₹${vehicle.fuelRatePerKm.toStringAsFixed(0)}/km';
    }
    return 'Actual distance fuel billed separately as per vehicle rate';
  }

  void _showFareBreakdownSheet(RideState state) {
    final estimate = state.fareEstimate;
    final isService = state.selectedSector == 'service';
    final isPremium = state.selectedSector == 'premium';
    final isLogistics = state.selectedSector == 'logistics';

    showModalBottomSheet(
      context: context,
      backgroundColor: cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    isService
                        ? 'Trip-Based Service Breakdown'
                        : (isPremium
                              ? 'Premium Standby Estimate'
                              : 'Itemized Fare Breakdown'),
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: textWhite,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, color: textWhite),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (estimate == null) ...[
                _buildBreakdownRow('Status', 'Fare estimate calculating...'),
              ] else if (estimate.isRange || estimate.isUnavailable) ...[
                FareRangeDetails(estimate: estimate),
              ] else if (isService) ...[
                _buildBreakdownRow(
                  'Base Mobilization / Dispatch',
                  '₹${estimate.baseAmount.toStringAsFixed(2)}',
                ),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Service & Transit Charge (${estimate.distanceKm.toStringAsFixed(1)} km)',
                  '₹${estimate.distanceAmount.toStringAsFixed(2)}',
                ),
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow(
                    'Taxes & Regulatory Fees (5% GST)',
                    '₹${estimate.taxAmount!.toStringAsFixed(2)}',
                  ),
                ],
              ] else if (isPremium) ...[
                _buildBreakdownRow(
                  'Chauffeur Standby Package Base',
                  '₹${estimate.baseAmount.toStringAsFixed(2)}',
                ),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Standby Duration Charge (~${estimate.durationMinutes} mins)',
                  '₹${estimate.timeAmount.toStringAsFixed(2)}',
                ),
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow(
                    'Taxes & Regulatory Fees (5% GST)',
                    '₹${estimate.taxAmount!.toStringAsFixed(2)}',
                  ),
                ],
              ] else if (isLogistics) ...[
                _buildBreakdownRow(
                  'Base Logistics Charge',
                  '₹${estimate.baseAmount.toStringAsFixed(2)}',
                ),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Distance Charge (${estimate.distanceKm.toStringAsFixed(1)} km)',
                  '₹${estimate.distanceAmount.toStringAsFixed(2)}',
                ),
                if ((estimate.weightAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow(
                    'Weight Surcharge',
                    '₹${estimate.weightAmount!.toStringAsFixed(2)}',
                  ),
                ],
                if ((estimate.loadingAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow(
                    'Loading/Unloading Helper',
                    '₹${estimate.loadingAmount!.toStringAsFixed(2)}',
                  ),
                ],
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow(
                    'Taxes & Regulatory Fees (5% GST)',
                    '₹${estimate.taxAmount!.toStringAsFixed(2)}',
                  ),
                ],
              ] else ...[
                _buildBreakdownRow(
                  'Base Fare',
                  '₹${estimate.baseAmount.toStringAsFixed(2)}',
                ),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Distance Charge (${estimate.distanceKm.toStringAsFixed(1)} km)',
                  '₹${estimate.distanceAmount.toStringAsFixed(2)}',
                ),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Time Charge (~${estimate.durationMinutes} mins)',
                  '₹${estimate.timeAmount.toStringAsFixed(2)}',
                ),
                if ((estimate.waitingAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow(
                    'Waiting Charge (>3 min)',
                    '₹${estimate.waitingAmount!.toStringAsFixed(2)}',
                  ),
                ],
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow(
                    'Taxes & Regulatory Fees (5% GST)',
                    '₹${estimate.taxAmount!.toStringAsFixed(2)}',
                  ),
                ],
              ],
              const Divider(height: 24, color: borderCard),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    isPremium ? 'Total Booking Advance' : 'Total Fare',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: textWhite,
                    ),
                  ),
                  Text(
                    estimate?.displayFare ?? '--',
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 20,
                      color: brandGreen,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
            ],
          ),
        );
      },
    );
  }

  Widget _buildBreakdownRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: textGray, fontSize: 14)),
        Text(
          value,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 14,
            color: textWhite,
          ),
        ),
      ],
    );
  }

  String _appBarTitle(RideStatus status) {
    switch (status) {
      case RideStatus.searching:
        return 'Finding your driver…';
      case RideStatus.matched:
        return 'Driver matched';
      case RideStatus.arrived:
        return 'Driver has arrived';
      case RideStatus.active:
        return 'Ride in progress';
      case RideStatus.completed:
        return 'Ride completed';
      case RideStatus.cancelled:
        return 'Ride cancelled';
      case RideStatus.initial:
      case RideStatus.error:
        return 'Book a Ride';
    }
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);

    final pickupLatLng = rideState.currentRide != null
        ? LatLng(
            rideState.currentRide!.pickup.latitude,
            rideState.currentRide!.pickup.longitude,
          )
        : rideState.pickupCoords;

    final destinationLatLng = rideState.currentRide != null
        ? LatLng(
            rideState.currentRide!.destination.latitude,
            rideState.currentRide!.destination.longitude,
          )
        : rideState.destinationCoords;

    final isInitial =
        (rideState.status == RideStatus.initial ||
        rideState.status == RideStatus.error);

    return Scaffold(
      backgroundColor: mainBg,
      appBar: isInitial
          ? null
          : AppBar(
              title: Text(
                _appBarTitle(rideState.status),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
              backgroundColor: const Color(0xFF032213),
              foregroundColor: Colors.white,
              elevation: 0,
              leading: IconButton(
                icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                onPressed: () {
                  if (rideState.status == RideStatus.completed) {
                    ref.read(rideProvider.notifier).resetRide();
                  }
                  context.pop();
                },
              ),
            ),
      body: LayoutBuilder(
        builder: (context, constraints) => Stack(
          fit: StackFit.expand,
          children: [
            // 1. Google Map
            InfurnusMap(
              bottomOverlayHeight: constraints.maxHeight * .55,
              pickup: pickupLatLng,
              destination: destinationLatLng,
              driverLocation: rideState.lastDriverLocation,
              route: rideState.currentRoute,
            ),
            if (rideState.mapError != null)
              Positioned(
                top: 120,
                left: 8,
                right: 8,
                child: Material(
                  color: cardBg,
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            rideState.mapError!,
                            style: const TextStyle(color: textWhite),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Retry route',
                          onPressed: () =>
                              ref.read(rideProvider.notifier).refreshRideMap(),
                          icon: const Icon(Icons.refresh, color: textWhite),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // Floating Back Button on Map (matching reference Screenshot 3)
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              left: 16,
              child: CircleAvatar(
                backgroundColor: Colors.white,
                radius: 20,
                child: IconButton(
                  icon: const Icon(
                    Icons.arrow_back_rounded,
                    color: Color(0xFF111827),
                    size: 20,
                  ),
                  onPressed: () {
                    if (rideState.status == RideStatus.completed) {
                      ref.read(rideProvider.notifier).resetRide();
                    }
                    context.pop();
                  },
                ),
              ),
            ),

            // Floating Pickup Location Pill with Edit Pencil (matching reference Screenshot 3)
            if (rideState.pickup != null && rideState.pickup!.isNotEmpty)
              Positioned(
                top: MediaQuery.of(context).padding.top + 8,
                left: 68,
                right: 16,
                child: GestureDetector(
                  onTap: () => context.push(
                    '/pickup-selection',
                    extra: rideState.selectedSector,
                  ),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 9,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.12),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            rideState.pickup!,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF111827),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        const Icon(
                          Icons.edit_outlined,
                          size: 16,
                          color: Color(0xFF16A34A),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // Floating "+ Add stop" Button on Map (matching reference Screenshot 3)
            Positioned(
              bottom: constraints.maxHeight * 0.55 + 14,
              right: 16,
              child: GestureDetector(
                onTap: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Multi-stop booking will be available soon!',
                      ),
                      duration: Duration(seconds: 2),
                    ),
                  );
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.12),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.add_rounded,
                        size: 16,
                        color: Color(0xFF111827),
                      ),
                      SizedBox(width: 4),
                      Text(
                        'Add stop',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                          color: Color(0xFF111827),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // 2. Dynamic Bottom Panel
            Align(
              alignment: Alignment.bottomCenter,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: constraints.maxHeight * 0.55,
                ),
                child: SingleChildScrollView(
                  child: Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: isInitial ? Colors.white : cardBg,
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(24),
                      ),
                      border: Border(
                        top: BorderSide(
                          color: isInitial
                              ? const Color(0xFFE5E7EB)
                              : borderCard,
                          width: 1.0,
                        ),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(
                            alpha: isInitial ? 0.08 : 0.6,
                          ),
                          blurRadius: 16,
                          offset: const Offset(0, -4),
                        ),
                      ],
                    ),
                    child: _buildPanelContent(rideState),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPanelContent(RideState rideState) {
    switch (rideState.status) {
      case RideStatus.initial:
      case RideStatus.error:
        return _buildBookingSetupPanel(rideState);

      case RideStatus.searching:
        return _buildSearchingPanel(rideState);

      case RideStatus.matched:
        return _buildDriverAssignedPanel(
          rideState,
          'Driver Assigned & Heading to You',
        );

      case RideStatus.arrived:
        return _buildDriverArrivedPanel(rideState);

      case RideStatus.active:
        return _buildRideInProgressPanel(rideState);

      case RideStatus.completed:
        return _buildRideCompletedPanel(rideState);

      case RideStatus.cancelled:
        return _buildRideCancelledPanel(rideState);
    }
  }

  // --- Step 1: Booking Setup & 4-Sector Selection ---
  Widget _buildBookingSetupPanel(RideState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Bottom Sheet Drag Handle
        Center(
          child: Container(
            width: 38,
            height: 4,
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: const Color(0xFFD1D5DB),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        if (state.errorMessage != null) _buildErrorBanner(state.errorMessage!),

        // Route Inputs
        _buildRouteInputs(),
        if (state.currentRoute != null)
          RouteDistanceSummary(route: state.currentRoute!),
        const SizedBox(height: 12),

        // Selected Vehicle Summary (set from dashboard — no catalogue repeated here)
        _buildSelectedVehicleChip(state),
        const SizedBox(height: 14),

        // Sector-specific options
        if (state.selectedSector == 'service') ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF3A1111),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: serviceRed.withValues(alpha: 0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.emergency_rounded, color: serviceRed, size: 18),
                    SizedBox(width: 8),
                    Text(
                      'Emergency & Special Dispatch',
                      style: TextStyle(
                        color: serviceRed,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _serviceNotesController,
                  style: const TextStyle(color: textWhite),
                  decoration: const InputDecoration(
                    hintText: 'Emergency triage / breakdown reason (e.g. cardiac patient, flat tire, site work)',
                    hintStyle: TextStyle(color: textGray, fontSize: 12),
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (val) {
                    ref.read(rideProvider.notifier).setServiceDetails({
                      'serviceType': state.selectedTier,
                      'emergencyLevel': 'high',
                      'description': val,
                    });
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],

        if (state.selectedSector == 'premium') ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF1F1A00),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: goldAccent.withValues(alpha: 0.4)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Chauffeur Standby Package',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                          color: goldAccent,
                        ),
                      ),
                      Text(
                        _getFuelNoticeText(state),
                        style: const TextStyle(fontSize: 11, color: textGray),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: () => context.push('/rentals'),
                  child: const Text(
                    'Configure >',
                    style: TextStyle(
                      color: goldAccent,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],

        // Route Estimate Info Pill
        if (state.currentRoute == null &&
            state.distanceKm != null &&
            state.durationMinutes != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: cardElevated,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: borderCard),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.straighten_rounded,
                      size: 16,
                      color: textGray,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${state.distanceKm!.toStringAsFixed(1)} km',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: textWhite,
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    const Icon(
                      Icons.access_time_rounded,
                      size: 16,
                      color: textGray,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '~${state.durationMinutes} mins',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: textWhite,
                      ),
                    ),
                  ],
                ),
                GestureDetector(
                  onTap: () => _showFareBreakdownSheet(state),
                  child: const Row(
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        size: 16,
                        color: brandGreen,
                      ),
                      SizedBox(width: 4),
                      Text(
                        'Breakdown',
                        style: TextStyle(
                          fontSize: 12,
                          color: brandGreen,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 16),

        // Payment Method & Coupon Row
        Row(
          children: [
            // Cash selector
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: const Row(
                children: [
                  Icon(
                    Icons.payments_outlined,
                    size: 16,
                    color: Color(0xFF16A34A),
                  ),
                  SizedBox(width: 6),
                  Text(
                    'Cash',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF111827),
                    ),
                  ),
                  SizedBox(width: 4),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 16,
                    color: Color(0xFF6B7280),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            // Apply Coupon
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: const Row(
                children: [
                  Icon(
                    Icons.local_offer_outlined,
                    size: 16,
                    color: Color(0xFF16A34A),
                  ),
                  SizedBox(width: 6),
                  Text(
                    'Apply Coupon',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF111827),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // Confirm CTA Button (Handles All Dynamic Route/Fare/Debounce States)
        _buildConfirmButton(state),
      ],
    );
  }

  Widget _buildRouteInputs() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: const BoxDecoration(
                  color: Color(0xFF16A34A),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Pickup Location',
                      style: TextStyle(
                        fontSize: 11,
                        color: Color(0xFF9CA3AF),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    TextField(
                      controller: _pickupController,
                      onChanged: (query) =>
                          _onLocationQueryChanged(query, isPickup: true),
                      style: const TextStyle(
                        color: Color(0xFF111827),
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                      decoration: const InputDecoration(
                        hintText: 'Current Location',
                        hintStyle: TextStyle(
                          color: Color(0xFF111827),
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.only(top: 2, bottom: 2),
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(
                  Icons.my_location_rounded,
                  size: 20,
                  color: Color(0xFF16A34A),
                ),
                tooltip: 'Current GPS',
                onPressed: _detectCurrentLocation,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
          _buildLocationSuggestions(isPickup: true),
          const Divider(height: 18, color: Color(0xFFE5E7EB)),
          Row(
            children: [
              const Icon(
                Icons.location_on_rounded,
                color: Color(0xFFDC2626),
                size: 16,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Destination',
                      style: TextStyle(
                        fontSize: 11,
                        color: Color(0xFF9CA3AF),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    TextField(
                      controller: _destinationController,
                      onChanged: (query) =>
                          _onLocationQueryChanged(query, isPickup: false),
                      style: const TextStyle(
                        color: Color(0xFF111827),
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                      decoration: const InputDecoration(
                        hintText: 'Where to?',
                        hintStyle: TextStyle(
                          color: Color(0xFF9CA3AF),
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.only(top: 2, bottom: 2),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          _buildLocationSuggestions(isPickup: false),
        ],
      ),
    );
  }

  bool _isTierMatching(String selectedTier, String category, int index) {
    if (selectedTier.isEmpty) return index == 0;
    final s = selectedTier.toLowerCase().trim();
    final c = category.toLowerCase().trim();
    if (s == c) return true;
    if (s == 'innova crysta' && c == 'innova') return true;
    if (s == 'force traveller' &&
        (c == 'traveller' || c == 'force_traveller')) {
      return true;
    }
    if ((s == '207 cargo' || s == '207 heavy' || s == 'cargo_207_heavy') &&
        (c == 'cargo_207' || c == 'cargo_207_heavy')) {
      return true;
    }
    if ((s == '407 cargo' || s == 'tata_407') &&
        (c == 'cargo_407' || c == 'tata_407')) {
      return true;
    }
    if ((s == 'piaggio ape' || s == 'three_wheeler') &&
        (c == 'piaggio_ape' || c == 'three_wheeler')) {
      return true;
    }
    if ((s == 'tata magic' || s == 'mini_truck') &&
        (c == 'tata_magic' || c == 'mini_truck')) {
      return true;
    }
    return false;
  }

  List<Map<String, dynamic>> _getVehiclesForSector(String sector) {
    switch (sector.toLowerCase()) {
      case 'logistics':
        return [
          {
            'name': 'Piaggio Ape',
            'category': 'piaggio_ape',
            'capacity': 'Up to 500 kg',
            'icon': Icons.local_shipping_outlined,
            'image': 'assets/images/piaggio_ape_yellow.png',
          },
          {
            'name': 'Tata Magic',
            'category': 'tata_magic',
            'capacity': 'Up to 750 kg',
            'icon': Icons.local_shipping_rounded,
            'image': 'assets/images/tata_magic_cream.png',
          },
          {
            'name': '207 Cargo',
            'category': 'cargo_207',
            'capacity': 'Up to 1500 kg',
            'icon': Icons.local_shipping_rounded,
            'image': 'assets/images/cargo_207_heavy.png',
          },
          {
            'name': '407 Cargo',
            'category': 'cargo_407',
            'capacity': 'Up to 2500 kg',
            'icon': Icons.local_shipping_rounded,
            'image': 'assets/images/cargo_407.jpg',
          },
        ];
      case 'service':
        return [
          {
            'name': 'Ambulance',
            'category': 'ambulance',
            'capacity': 'Emergency',
            'icon': Icons.medical_services_rounded,
            'image': 'assets/images/ambulance_van.png',
          },
          {
            'name': 'Towing Van',
            'category': 'towing',
            'capacity': 'Breakdown',
            'icon': Icons.car_repair_rounded,
            'image': 'assets/images/towing_van.jpg',
          },
          {
            'name': 'JCB Excavator',
            'category': 'jcb',
            'capacity': 'Construction',
            'icon': Icons.construction_rounded,
            'image': 'assets/images/jcb_excavator.jpg',
          },
          {
            'name': 'Crane',
            'category': 'crane',
            'capacity': 'Heavy Lift',
            'icon': Icons.precision_manufacturing_rounded,
            'image': 'assets/images/crane_truck.png',
          },
        ];
      case 'premium':
      case 'rental':
      case 'rentals':
        return [
          {
            'name': 'Scorpio N',
            'category': 'scorpio',
            'capacity': 'Rugged SUV',
            'icon': Icons.directions_car_filled_rounded,
            'image': 'assets/images/scorpio_n_white.png',
          },
          {
            'name': 'Mahindra Thar',
            'category': 'thar',
            'capacity': 'Off-road 4x4',
            'icon': Icons.terrain_rounded,
            'image': 'assets/images/thar_visual.webp',
          },
          {
            'name': 'Innova Crysta',
            'category': 'innova',
            'capacity': 'Executive 7S',
            'icon': Icons.airport_shuttle_rounded,
            'image': 'assets/images/innova_crysta.jpg',
          },
          {
            'name': 'Force Urbania',
            'category': 'traveller',
            'capacity': 'Executive Van',
            'icon': Icons.airport_shuttle_rounded,
            'image': 'assets/images/force_urbania.jpg',
          },
        ];
      case 'passenger':
      default:
        return [
          {
            'name': 'Hatchback',
            'category': 'hatchback',
            'capacity': '4 seats',
            'icon': Icons.directions_car_rounded,
            'image': 'assets/images/hatchback.jpg',
          },
          {
            'name': 'Sedan',
            'category': 'sedan',
            'capacity': '4 seats',
            'icon': Icons.directions_car_rounded,
            'image': 'assets/images/sedan.jpg',
          },
          {
            'name': 'Innova Crysta',
            'category': 'innova',
            'capacity': '6-7 seats',
            'icon': Icons.directions_car_filled_rounded,
            'image': 'assets/images/innova_crysta.jpg',
          },
          {
            'name': 'Winger',
            'category': 'winger',
            'capacity': '9-12 seats',
            'icon': Icons.directions_bus_rounded,
            'image': 'assets/images/winger_tata.jpg',
          },
          {
            'name': 'Force Traveller',
            'category': 'traveller',
            'capacity': '12 seats',
            'icon': Icons.airport_shuttle_rounded,
            'image': 'assets/images/force_urbania.jpg',
          },
        ];
    }
  }

  bool _isUnsupportedVehicle(RideState state) {
    if (state.selectedSector != 'passenger' &&
        state.selectedSector.isNotEmpty) {
      return false;
    }
    return isExcludedPassengerVehicle(state.selectedTier);
  }

  void _showVehicleSelectionBottomSheet(RideState state) {
    final vehicles = _getVehiclesForSector(state.selectedSector);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFD1D5DB),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Select Vehicle',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF111827),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () => Navigator.pop(sheetContext),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(context).size.height * 0.5,
                  ),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: vehicles.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final v = vehicles[index];
                      final isSelected = _isTierMatching(
                        state.selectedTier,
                        v['category'] as String,
                        0,
                      );
                      return InkWell(
                        onTap: () {
                          ref
                              .read(rideProvider.notifier)
                              .selectTier(v['category'] as String);
                          Navigator.pop(sheetContext);
                        },
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? const Color(0xFFF0FDF4)
                                : Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: isSelected
                                  ? const Color(0xFF16A34A)
                                  : const Color(0xFFE5E7EB),
                              width: isSelected ? 1.5 : 1,
                            ),
                          ),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 44,
                                height: 36,
                                child: v['image'] != null
                                    ? Image.asset(
                                        v['image'] as String,
                                        fit: BoxFit.contain,
                                        errorBuilder: (_, __, ___) => Icon(
                                          v['icon'] as IconData,
                                          size: 24,
                                          color: const Color(0xFF16A34A),
                                        ),
                                      )
                                    : Icon(
                                        v['icon'] as IconData,
                                        size: 24,
                                        color: const Color(0xFF16A34A),
                                      ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      v['name'] as String,
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.bold,
                                        color: Color(0xFF111827),
                                      ),
                                    ),
                                    Text(
                                      v['capacity'] as String? ?? '',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: Color(0xFF6B7280),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (isSelected)
                                const Icon(
                                  Icons.check_circle_rounded,
                                  color: Color(0xFF16A34A),
                                  size: 20,
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// Compact chip showing which vehicle/service the customer already selected
  /// on the dashboard — no sector tabs, no full catalogue repeated here.
  Widget _buildSelectedVehicleChip(RideState state) {
    if (_isUnsupportedVehicle(state)) {
      return InkWell(
        onTap: () => _showVehicleSelectionBottomSheet(state),
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF2F2),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: const Color(0xFFDC2626).withValues(alpha: 0.5),
            ),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.warning_amber_rounded,
                color: Color(0xFFDC2626),
                size: 26,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'Vehicle Not Available',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF991B1B),
                      ),
                    ),
                    Text(
                      'Bike, Auto & E-Rickshaw are excluded. Tap to choose a cab.',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.red.shade700,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFDC2626),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Text(
                  'Select',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final vehicles = _getVehiclesForSector(state.selectedSector);
    final selected = vehicles.firstWhere(
      (v) => _isTierMatching(state.selectedTier, v['category'] as String, 0),
      orElse: () => vehicles.isNotEmpty ? vehicles.first : <String, dynamic>{},
    );

    if (selected.isEmpty) return const SizedBox.shrink();

    final sectorLabel =
        {
          'passenger': 'Rides',
          'logistics': 'Logistics',
          'service': 'Emergency',
          'premium': 'Rentals',
        }[state.selectedSector] ??
        'Ride';

    final String fareBadge;
    if (state.isEstimatingFare) {
      fareBadge = 'Calculating…';
    } else if (state.fareEstimate != null) {
      fareBadge = state.fareEstimate!.displayFare;
    } else {
      fareBadge = selected['capacity'] as String? ?? '';
    }

    return InkWell(
      onTap: () => _showVehicleSelectionBottomSheet(state),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFF0FDF4),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: const Color(0xFF16A34A).withValues(alpha: 0.35),
          ),
        ),
        child: Row(
          children: [
            // Vehicle thumbnail
            SizedBox(
              width: 52,
              height: 40,
              child: selected['image'] != null
                  ? Image.asset(
                      selected['image'] as String,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => Icon(
                        selected['icon'] as IconData,
                        size: 28,
                        color: const Color(0xFF16A34A),
                      ),
                    )
                  : Icon(
                      selected['icon'] as IconData,
                      size: 28,
                      color: const Color(0xFF16A34A),
                    ),
            ),
            const SizedBox(width: 12),
            // Name + sector
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Text(
                        selected['name'] as String,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF111827),
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Icon(
                        Icons.unfold_more_rounded,
                        size: 16,
                        color: Color(0xFF16A34A),
                      ),
                    ],
                  ),
                  Text(
                    sectorLabel,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF6B7280),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            // Fare / capacity badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: state.fareEstimate != null
                    ? const Color(0xFF16A34A)
                    : const Color(0xFFE5E7EB),
                borderRadius: BorderRadius.circular(20),
              ),
              child: state.isEstimatingFare
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Color(0xFF16A34A),
                      ),
                    )
                  : Text(
                      fareBadge,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: state.fareEstimate != null
                            ? Colors.white
                            : const Color(0xFF374151),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConfirmButton(RideState state) {
    if (_isUnsupportedVehicle(state)) {
      return SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFDC2626),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(26),
            ),
          ),
          icon: const Icon(Icons.directions_car_rounded, size: 20),
          label: const Text(
            'Select a Valid Passenger Vehicle',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
          onPressed: () => _showVehicleSelectionBottomSheet(state),
        ),
      );
    }

    final hasLocations =
        state.pickupCoords != null &&
        state.destinationCoords != null &&
        _pickupController.text.trim().isNotEmpty &&
        _destinationController.text.trim().isNotEmpty;

    final vehicles = _getVehiclesForSector(state.selectedSector);
    final selectedVehicle = vehicles.firstWhere(
      (v) => v['category'] == state.selectedTier,
      orElse: () => vehicles.isNotEmpty ? vehicles.first : {'name': 'Ride'},
    );
    final vehicleName = selectedVehicle['name'] as String;

    if (!hasLocations) {
      return SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFE5E7EB),
            foregroundColor: const Color(0xFF9CA3AF),
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(26),
            ),
          ),
          onPressed: null,
          child: const Text(
            'Select Destination to View Fares',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
        ),
      );
    }

    if (state.isEstimatingFare) {
      return SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF111827),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(26),
            ),
          ),
          onPressed: null,
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Color(0xFF16A34A),
                ),
              ),
              SizedBox(width: 12),
              Text(
                'Calculating Live Route Fare...',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (state.errorMessage != null && state.fareEstimate == null) {
      return SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFDC2626),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(26),
            ),
          ),
          icon: const Icon(Icons.refresh_rounded, size: 20),
          label: const Text(
            'Retry Fare Calculation',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
          onPressed: () => ref.read(rideProvider.notifier).estimateRouteFare(),
        ),
      );
    }

    final fareText =
        state.fareEstimate?.displayFare ??
        (state.fare != null ? '₹${state.fare!.toStringAsFixed(2)}' : '');
    final buttonTitle = fareText.isNotEmpty
        ? 'Book $vehicleName • $fareText'
        : 'Book $vehicleName';

    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: _isSubmittingBooking
              ? const Color(0xFF4B5563)
              : const Color(0xFF111827),
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(26),
          ),
        ),
        onPressed: _isSubmittingBooking ? null : _handleBooking,
        child: _isSubmittingBooking
            ? const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  ),
                  SizedBox(width: 12),
                  Text(
                    'Confirming Booking...',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ],
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    buttonTitle,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(
                    Icons.arrow_forward_rounded,
                    size: 18,
                    color: Color(0xFF16A34A),
                  ),
                ],
              ),
      ),
    );
  }

  // ignore: unused_element
  String _getVehicleImagePath(FleetVehicleModel vehicle) {
    final cat = vehicle.category.toLowerCase();
    final name = vehicle.displayName.toLowerCase();
    if (cat.contains('jcb') ||
        name.contains('jcb') ||
        cat.contains('excavator') ||
        name.contains('excavator')) {
      return 'assets/images/jcb_excavator.jpg';
    }
    if (cat.contains('crane') || name.contains('crane')) {
      return 'assets/images/crane_truck.png';
    }
    if (cat.contains('garbage') ||
        name.contains('garbage') ||
        cat.contains('dump') ||
        name.contains('dump')) {
      return 'assets/images/garbage_dump_truck.png';
    }
    if (cat.contains('bike') || name.contains('bike')) {
      return 'assets/images/bike_motorcycle.png';
    }
    if (cat.contains('auto') || name.contains('auto')) {
      return 'assets/images/auto_rickshaw.png';
    }
    if (cat.contains('hatchback') ||
        name.contains('hatchback') ||
        cat.contains('baleno') ||
        name.contains('baleno')) {
      return 'assets/images/hatchback.jpg';
    }
    if (cat.contains('sedan') || name.contains('sedan')) {
      return 'assets/images/sedan.jpg';
    }
    if (cat.contains('innova') || name.contains('innova')) {
      return 'assets/images/innova_crysta.jpg';
    }
    if (cat.contains('scorpio') || name.contains('scorpio')) {
      return 'assets/images/scorpio_n_white.png';
    }
    if (cat.contains('thar') || name.contains('thar')) {
      return 'assets/images/thar_visual.webp';
    }
    if (cat.contains('fortuner') || name.contains('fortuner')) {
      return 'assets/images/fortuner_visual.jpg';
    }
    if (cat.contains('suv') || name.contains('suv')) {
      return 'assets/images/scorpio_n_white.png';
    }
    if (cat.contains('winger') || name.contains('winger')) {
      return 'assets/images/winger_tata.jpg';
    }
    if (cat.contains('traveller') ||
        name.contains('traveller') ||
        cat.contains('urbania') ||
        name.contains('urbania')) {
      return 'assets/images/force_traveller_van.jpg';
    }
    if (cat.contains('towing') ||
        name.contains('towing') ||
        cat.contains('roadside') ||
        name.contains('roadside')) {
      return 'assets/images/towing_van.jpg';
    }
    if (cat.contains('ambulance') || name.contains('ambulance')) {
      return 'assets/images/ambulance_van.png';
    }
    if (cat.contains('mini truck') ||
        name.contains('mini truck') ||
        cat.contains('mini_truck') ||
        name.contains('mini_truck')) {
      return 'assets/images/mini_truck.jpg';
    }
    if (cat.contains('ape') ||
        name.contains('ape') ||
        cat.contains('commercial') ||
        name.contains('commercial')) {
      return 'assets/images/mini_commercial.jpg';
    }
    if (cat.contains('magic') || name.contains('magic')) {
      return 'assets/images/tata_magic_cream.png';
    }
    if ((cat.contains('207') || name.contains('207')) &&
        (cat.contains('heavy') || name.contains('heavy'))) {
      return 'assets/images/cargo_207_heavy.png';
    }
    if (cat.contains('207') || name.contains('207')) {
      return 'assets/images/cargo_207_normal.png';
    }
    if (cat.contains('407') || name.contains('407')) {
      return 'assets/images/cargo_407.jpg';
    }
    return 'assets/images/sedan.jpg';
  }

  // ignore: unused_element
  IconData _vehicleIcon(FleetVehicleModel vehicle) {
    final cat = vehicle.category.toLowerCase();
    final name = vehicle.displayName.toLowerCase();

    if (cat.contains('bike') || name.contains('bike')) {
      return Icons.two_wheeler_rounded;
    }
    if (cat.contains('auto') ||
        name.contains('auto') ||
        cat.contains('three_wheeler')) {
      return Icons.electric_rickshaw_rounded;
    }
    if (cat.contains('ambulance') || name.contains('ambulance')) {
      return Icons.medical_services_rounded;
    }
    if (cat.contains('towing') || name.contains('towing')) {
      return Icons.car_repair_rounded;
    }
    if (cat.contains('jcb') ||
        name.contains('jcb') ||
        cat.contains('roller') ||
        name.contains('roller')) {
      return Icons.construction_rounded;
    }
    if (cat.contains('thar') || name.contains('thar')) {
      return Icons.terrain_rounded;
    }
    if (cat.contains('fortuner') || name.contains('fortuner')) {
      return Icons.directions_car_filled_rounded;
    }
    if (cat.contains('luxury') ||
        cat.contains('bmw') ||
        cat.contains('mercedes') ||
        name.contains('suv')) {
      return Icons.stars_rounded;
    }
    if (vehicle.sector == 'logistics' ||
        cat.contains('truck') ||
        cat.contains('shipping')) {
      return Icons.local_shipping_rounded;
    }
    if (vehicle.sector == 'service') {
      return Icons.build_rounded;
    }
    if (cat.contains('sedan')) {
      return Icons.airport_shuttle_rounded;
    }
    return Icons.directions_car_rounded;
  }

  // --- Step 2: Searching Radar Sheet ---
  Widget _buildSearchingPanel(RideState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 12),
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            color: brandGreen.withValues(alpha: 0.15),
            shape: BoxShape.circle,
          ),
          child: const Center(
            child: SizedBox(
              width: 42,
              height: 42,
              child: CircularProgressIndicator(
                strokeWidth: 3,
                color: brandGreen,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Connecting to nearby drivers...',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: textWhite,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Matching in ${state.selectedSector.toUpperCase()} sector • Fare ₹${state.fare?.toStringAsFixed(2) ?? "---"}',
          style: const TextStyle(color: textGray, fontSize: 13),
        ),
        const SizedBox(height: 24),
        InfurnusOutlinedButton(
          text: 'Cancel Request',
          onPressed: () => ref.read(rideProvider.notifier).cancelRide(),
        ),
      ],
    );
  }

  // --- Step 3: Driver Assigned & Arriving ---
  Widget _buildDriverAssignedPanel(RideState state, String title) {
    final ride = state.currentRide;
    final driver = ride?.driverDetails;
    final vehicle = ride?.vehicleDetails;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: textWhite,
                  ),
                ),
                const Text(
                  'ETA: ~3 mins away',
                  style: TextStyle(
                    color: brandGreen,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: brandGreen.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'MATCHED',
                style: TextStyle(
                  color: brandGreen,
                  fontWeight: FontWeight.bold,
                  fontSize: 11,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // Driver Card
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: cardElevated,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: borderCard),
          ),
          child: Row(
            children: [
              const CircleAvatar(
                radius: 26,
                backgroundColor: Color(0xFF1A1A1A),
                child: Icon(Icons.person_rounded, color: textWhite, size: 28),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      driver?.name.isNotEmpty == true
                          ? driver!.name
                          : (state.driverName ??
                                'Matching driver details from fleet server...'),
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: textWhite,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        if (driver?.rating != null) ...[
                          const Icon(
                            Icons.star_rounded,
                            color: goldAccent,
                            size: 14,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '${driver!.rating!.toStringAsFixed(1)} • Verified Driver',
                            style: const TextStyle(
                              color: textGray,
                              fontSize: 12,
                            ),
                          ),
                        ] else ...[
                          const Icon(
                            Icons.verified_rounded,
                            color: brandGreen,
                            size: 14,
                          ),
                          const SizedBox(width: 4),
                          const Text(
                            'Verified Driver',
                            style: TextStyle(color: textGray, fontSize: 12),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      vehicle != null && vehicle.make.isNotEmpty
                          ? '${vehicle.make} ${vehicle.model} • ${vehicle.plateNumber}'
                          : (state.vehicleInfo ??
                                'Vehicle details pending assignment from fleet...'),
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                        color: textWhite,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.phone_rounded, color: brandGreen),
                onPressed: (driver?.phone != null && driver!.phone!.isNotEmpty)
                    ? () {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Calling ${driver.name}...')),
                        );
                      }
                    : null,
              ),
            ],
          ),
        ),
        if (ride?.pin != null && ride?.pinVerified != true) ...[
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: cardElevated,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: borderCard),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Pickup PIN (share with driver):',
                  style: TextStyle(color: textGray, fontSize: 13),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: brandGreen,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    ride!.pin!,
                    style: const TextStyle(
                      color: Colors.black,
                      fontWeight: FontWeight.w900,
                      fontSize: 16,
                      letterSpacing: 2,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),

        Row(
          children: [
            Expanded(
              child: InfurnusOutlinedButton(
                text: 'Cancel Ride',
                onPressed: () => ref.read(rideProvider.notifier).cancelRide(),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: InfurnusButton(
                text: 'Safety / Share',
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Live trip details shared with emergency contacts',
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ],
    );
  }

  // --- Step 4: Driver Arrived ---
  Widget _buildDriverArrivedPanel(RideState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF12351F),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: brandGreen.withValues(alpha: 0.4)),
          ),
          child: const Row(
            children: [
              Icon(Icons.check_circle_rounded, color: brandGreen),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Driver has arrived at your pickup spot!',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: textWhite,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),

        // Live Free/Billable Waiting Timer
        WaitingTimerWidget(
          arrivalTime: state.currentRide?.updatedAt ?? DateTime.now(),
          isCustomerView: true,
        ),
        const SizedBox(height: 10),

        // Verification OTP Pill
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: cardElevated,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: borderCard),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Share PIN with Driver:',
                style: TextStyle(color: textGray, fontSize: 13),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: brandGreen,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  state.currentRide?.pin ?? '----',
                  style: const TextStyle(
                    color: Colors.black,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    letterSpacing: 2,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        _buildDriverAssignedPanel(state, 'Your driver is waiting'),
      ],
    );
  }

  // --- Step 5: Ride in Progress ---
  Widget _buildRideInProgressPanel(RideState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Row(
              children: [
                Icon(Icons.navigation_rounded, color: brandGreen, size: 20),
                SizedBox(width: 8),
                Text(
                  'Trip in Progress',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: textWhite,
                  ),
                ),
              ],
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: premiumBlue.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'ON ROUTE',
                style: TextStyle(
                  color: premiumBlue,
                  fontWeight: FontWeight.bold,
                  fontSize: 11,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),

        Text(
          'Destination: ${state.destination ?? "Destination"}',
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 13,
            color: textWhite,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 4),
        Text(
          'Live tracking active • Estimated arrival in ~${state.durationMinutes ?? 18} mins',
          style: const TextStyle(color: textGray, fontSize: 12),
        ),
        const SizedBox(height: 16),

        Row(
          children: [
            Expanded(
              child: ElevatedButton.icon(
                icon: const Icon(
                  Icons.shield_outlined,
                  color: Colors.white,
                  size: 18,
                ),
                label: const Text('Emergency SOS'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: serviceRed,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Safety team alerted')),
                  );
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: InfurnusButton(
                text: 'Share Trip',
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Trip tracking link copied')),
                  );
                },
              ),
            ),
          ],
        ),
      ],
    );
  }

  // --- Step 6: Ride Completed, Payment & Rating ---
  Widget _buildRideCompletedPanel(RideState state) {
    final ride = state.currentRide;
    final fare = ride?.finalFare ?? ride?.fareEstimate ?? state.fare ?? 0.0;
    final isPaid = state.paymentStatus == 'paid';
    final isPremium = ride?.sector == 'premium';

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Center(
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: brandGreen.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check_circle_rounded,
              size: 48,
              color: brandGreen,
            ),
          ),
        ),
        const SizedBox(height: 12),
        const Center(
          child: Text(
            'You have arrived! 🎉',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: textWhite,
            ),
          ),
        ),
        const SizedBox(height: 4),
        Center(
          child: Text(
            isPremium
                ? 'Premium trip reconciled & completed'
                : 'Trip completed successfully',
            style: const TextStyle(color: textGray, fontSize: 13),
          ),
        ),
        const SizedBox(height: 16),

        // Fare Summary Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: cardElevated,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: borderCard),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (isPremium) ...[
                const Row(
                  children: [
                    Icon(
                      Icons.receipt_long_rounded,
                      color: goldAccent,
                      size: 18,
                    ),
                    SizedBox(width: 8),
                    Text(
                      'Final Reconciled Bill',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: textWhite,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                _buildBreakdownRow(
                  'Booking Estimate',
                  ride?.fareEstimate != null
                      ? '₹${ride!.fareEstimate!.toStringAsFixed(2)}'
                      : '--',
                ),
                const SizedBox(height: 6),
                _buildBreakdownRow(
                  'Actual GPS Distance',
                  '${((ride?.actualDistanceMeters ?? 0) / 1000.0).toStringAsFixed(1)} km',
                ),
                const SizedBox(height: 6),
                _buildBreakdownRow(
                  'Actual Fuel Cost',
                  '₹${ride?.actualFuelCost?.toStringAsFixed(2) ?? "0.00"}',
                ),
                const Divider(height: 16, color: borderCard),
              ],
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isPremium
                            ? 'Authoritative Final Fare'
                            : 'Total Trip Fare',
                        style: const TextStyle(color: textGray, fontSize: 12),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '₹${fare.toStringAsFixed(2)}',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: brandGreen,
                        ),
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: isPaid
                          ? brandGreen.withValues(alpha: 0.15)
                          : const Color(0xFF3A290A),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      isPaid ? 'PAID' : 'PAYMENT DUE',
                      style: TextStyle(
                        color: isPaid ? brandGreen : goldAccent,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
              if (!isPaid) ...[
                const Divider(height: 20, color: borderCard),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Select Payment Method',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: textWhite,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _buildPaymentChip(
                      'cashfree',
                      'Cashfree PG',
                      Icons.credit_card_rounded,
                    ),
                    _buildPaymentChip(
                      'wallet',
                      'Wallet',
                      Icons.account_balance_wallet_rounded,
                    ),
                    _buildPaymentChip('upi', 'UPI', Icons.qr_code_rounded),
                    _buildPaymentChip('cash', 'Cash', Icons.money_rounded),
                  ],
                ),
                const SizedBox(height: 14),
                InfurnusButton(
                  text: 'Pay ₹${fare.toStringAsFixed(2)}',
                  isLoading: _isProcessingPayment,
                  onPressed: () async {
                    setState(() => _isProcessingPayment = true);
                    final success = await ref
                        .read(rideProvider.notifier)
                        .initiateTripPayment(
                          amount: fare,
                          paymentMethod: _selectedPaymentMethod,
                        );
                    if (mounted) {
                      setState(() => _isProcessingPayment = false);
                      if (success) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Payment processed successfully!'),
                          ),
                        );
                      }
                    }
                  },
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Star Rating & Review
        if (!state.isReviewSubmitted) ...[
          const Text(
            'Rate your driver & service',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 15,
              color: textWhite,
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(5, (index) {
                final starIndex = index + 1;
                return IconButton(
                  icon: Icon(
                    starIndex <= _selectedRating
                        ? Icons.star_rounded
                        : Icons.star_border_rounded,
                    color: goldAccent,
                    size: 32,
                  ),
                  onPressed: () => setState(() => _selectedRating = starIndex),
                );
              }),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _reviewController,
            style: const TextStyle(color: textWhite),
            decoration: InputDecoration(
              hintText:
                  'Share feedback (e.g. Prompt service, professional handling)',
              hintStyle: const TextStyle(color: textGray, fontSize: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 10,
              ),
            ),
          ),
          const SizedBox(height: 16),
          InfurnusButton(
            text: 'Submit Rating & Feedback',
            onPressed: () async {
              await ref
                  .read(rideProvider.notifier)
                  .rateAndReviewRide(_selectedRating, _reviewController.text);
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Thank you for your rating!')),
                );
              }
            },
          ),
        ] else ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF12351F),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Center(
              child: Text(
                '★ Rating & feedback submitted. Thank you for choosing INFURNUS!',
                style: TextStyle(
                  color: brandGreen,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          InfurnusButton(
            text: 'Back to Home',
            onPressed: () {
              ref.read(rideProvider.notifier).resetRide();
              context.go('/customer-home');
            },
          ),
        ],
      ],
    );
  }

  Widget _buildPaymentChip(String id, String label, IconData icon) {
    final isSelected = _selectedPaymentMethod == id;
    return GestureDetector(
      onTap: () => setState(() => _selectedPaymentMethod = id),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? brandGreen : cardElevated,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: borderCard),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: isSelected ? Colors.black : textWhite),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? Colors.black : textWhite,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // --- Step 7: Ride Cancelled ---
  Widget _buildRideCancelledPanel(RideState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.cancel_outlined, size: 48, color: serviceRed),
        const SizedBox(height: 12),
        const Text(
          'Ride Cancelled',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: textWhite,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          state.currentRide?.cancellationReason ?? 'The ride was cancelled.',
          style: const TextStyle(color: textGray, fontSize: 13),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 20),
        InfurnusButton(
          text: 'Book Another Ride',
          onPressed: () {
            ref.read(rideProvider.notifier).resetRide();
          },
        ),
      ],
    );
  }

  Widget _buildErrorBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF3A1111),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: serviceRed.withValues(alpha: 0.4)),
      ),
      child: Text(
        message,
        style: const TextStyle(color: textWhite, fontSize: 13),
      ),
    );
  }
}
