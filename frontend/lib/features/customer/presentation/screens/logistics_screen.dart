import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../../core/services/location_service.dart';
import '../../../../core/services/places_autocomplete_service.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../../data/models/fleet_vehicle_model.dart';
import '../providers/ride_use_case_providers.dart';
import '../providers/ride_provider.dart';

class LogisticsScreen extends ConsumerStatefulWidget {
  const LogisticsScreen({super.key});

  @override
  ConsumerState<LogisticsScreen> createState() => _LogisticsScreenState();
}

class _LogisticsScreenState extends ConsumerState<LogisticsScreen> {
  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color borderCard = Color(0xFF262626);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color brandGreen = Color(0xFF22C55E);
  static const Color logisticsOrange = Color(0xFFF59E0B);

  final _pickupController = TextEditingController();
  final _dropController = TextEditingController();
  final _itemDescController = TextEditingController();
  final _weightController = TextEditingController(text: '15');
  final _quantityController = TextEditingController(text: '1');

  String _selectedVehicle = '';
  String _selectedCategory = 'General Goods';
  bool _needLoadingHelper = false;
  bool _isLoadingVehicles = true;
  bool _isSubmittingBooking = false;
  List<FleetVehicleModel> _fleetVehicles = [];
  Timer? _pickupAutocompleteTimer;
  Timer? _destinationAutocompleteTimer;
  CancelToken? _pickupAutocompleteToken;
  CancelToken? _destinationAutocompleteToken;
  List<PlaceSuggestion> _pickupSuggestions = [];
  List<PlaceSuggestion> _destinationSuggestions = [];
  bool _isLoadingPickupSuggestions = false;
  bool _isLoadingDestinationSuggestions = false;
  bool? _activeAutocompleteIsPickup;

  final List<String> _categories = [
    'General Goods',
    'Electronics & Gadgets',
    'Furniture & Home',
    'Documents & Legal',
    'Machinery & Spares',
  ];

  @override
  void initState() {
    super.initState();
    final rideState = ref.read(rideProvider);
    _pickupController.text = rideState.pickup ?? '';
    _dropController.text = rideState.destination ?? '';
    _itemDescController.text = '';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _detectCurrentLocation();
      _fetchFleet();
    });
  }

  Future<void> _fetchFleet() async {
    try {
      final fleet = await ref.read(getFleetUseCaseProvider)(
        sector: 'logistics',
      );
      if (!mounted) return;
      setState(() {
        _fleetVehicles = fleet;
        _isLoadingVehicles = false;
        if (fleet.isNotEmpty &&
            !fleet.any((vehicle) => vehicle.category == _selectedVehicle)) {
          _selectedVehicle = fleet.first.category;
        }
      });
      _recalculateFare();
    } catch (error) {
      if (!mounted) return;
      setState(() => _isLoadingVehicles = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString()),
          backgroundColor: logisticsOrange,
        ),
      );
    }
  }

  Future<void> _detectCurrentLocation() async {
    try {
      final pos = await ref.read(locationServiceProvider).getCurrentPosition();
      if (pos != null && mounted) {
        ref
            .read(rideProvider.notifier)
            .setPickupCoords(
              LatLng(pos.latitude, pos.longitude),
              address: 'Current Location',
            );
        _pickupController.text = 'Current Location';
        _recalculateFare();
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString()),
            backgroundColor: logisticsOrange,
          ),
        );
      }
    }
  }

  void _onLocationQueryChanged(String query, {required bool isPickup}) {
    final controller = isPickup ? _pickupController : _dropController;
    final timer = isPickup
        ? _pickupAutocompleteTimer
        : _destinationAutocompleteTimer;
    final token = isPickup
        ? _pickupAutocompleteToken
        : _destinationAutocompleteToken;
    timer?.cancel();
    token?.cancel();
    _recalculateFare();

    if (query.trim().length < 2) {
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

    final debounceTimer = Timer(const Duration(milliseconds: 250), () async {
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
      } catch (_) {
        if (mounted && !cancelToken.isCancelled) {
          setState(() {
            if (isPickup) {
              _pickupSuggestions = [];
              _isLoadingPickupSuggestions = false;
            } else {
              _destinationSuggestions = [];
              _isLoadingDestinationSuggestions = false;
            }
          });
        }
      }
    });
    if (isPickup) {
      _pickupAutocompleteTimer = debounceTimer;
    } else {
      _destinationAutocompleteTimer = debounceTimer;
    }
  }

  void _selectLocationSuggestion(
    PlaceSuggestion suggestion, {
    required bool isPickup,
  }) {
    final latitude = suggestion.latitude;
    final longitude = suggestion.longitude;
    if (latitude == null || longitude == null) return;

    (isPickup ? _pickupAutocompleteTimer : _destinationAutocompleteTimer)
        ?.cancel();
    (isPickup ? _pickupAutocompleteToken : _destinationAutocompleteToken)
        ?.cancel();

    final address = suggestion.toString();
    final coordinates = LatLng(latitude, longitude);
    setState(() {
      _activeAutocompleteIsPickup = null;
      if (isPickup) {
        _pickupController.text = address;
        _pickupSuggestions = [];
        _isLoadingPickupSuggestions = false;
      } else {
        _dropController.text = address;
        _destinationSuggestions = [];
        _isLoadingDestinationSuggestions = false;
      }
    });

    final notifier = ref.read(rideProvider.notifier);
    if (isPickup) {
      notifier.setPickupCoords(coordinates, address: address);
    } else {
      notifier.setDestinationCoords(coordinates, address: address);
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
          ? const Padding(
              padding: EdgeInsets.all(14),
              child: Text(
                'No locations found',
                style: TextStyle(color: textGray, fontSize: 13),
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
                      color: logisticsOrange,
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

  @override
  void dispose() {
    _pickupController.dispose();
    _dropController.dispose();
    _itemDescController.dispose();
    _weightController.dispose();
    _quantityController.dispose();
    _pickupAutocompleteTimer?.cancel();
    _destinationAutocompleteTimer?.cancel();
    _pickupAutocompleteToken?.cancel();
    _destinationAutocompleteToken?.cancel();
    super.dispose();
  }

  void _recalculateFare() {
    final weight = double.tryParse(_weightController.text.trim()) ?? 15.0;
    final qty = int.tryParse(_quantityController.text.trim()) ?? 1;

    ref
        .read(rideProvider.notifier)
        .setRoute(_pickupController.text.trim(), _dropController.text.trim());
    ref.read(rideProvider.notifier).selectSector('logistics');
    ref.read(rideProvider.notifier).selectTier(_selectedVehicle);
    ref.read(rideProvider.notifier).setGoods({
      'itemType': _selectedCategory,
      'description': _itemDescController.text.trim(),
      'weightKg': weight,
      'quantity': qty,
      'loadingAssistance': _needLoadingHelper,
    });
  }

  Future<void> _handleBooking() async {
    if (_isSubmittingBooking) return;
    if (_pickupController.text.trim().isEmpty ||
        _dropController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter pickup and delivery addresses'),
        ),
      );
      return;
    }

    if (_selectedVehicle.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No freight vehicle is available.')),
      );
      return;
    }

    setState(() => _isSubmittingBooking = true);
    final notifier = ref.read(rideProvider.notifier);
    final previousRideId = ref.read(rideProvider).currentRide?.id;
    try {
      _recalculateFare();
      if (ref.read(rideProvider).pickupCoords == null &&
          !await notifier.geocodeAndSetPickup(_pickupController.text.trim())) {
        throw Exception(
          ref.read(rideProvider).errorMessage ??
              'Pickup location is unavailable.',
        );
      }
      if (ref.read(rideProvider).destinationCoords == null &&
          !await notifier.geocodeAndSetDestination(
            _dropController.text.trim(),
          )) {
        throw Exception(
          ref.read(rideProvider).errorMessage ?? 'Destination is unavailable.',
        );
      }

      await notifier.requestRide();
      final ride = ref.read(rideProvider).currentRide;
      if (!mounted) return;
      if (ride == null || ride.id == previousRideId) {
        throw Exception(
          ref.read(rideProvider).errorMessage ??
              'Ride booking was not created.',
        );
      }
      context.push('/ride-booking');
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString()),
            backgroundColor: logisticsOrange,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmittingBooking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final estimate = rideState.fareEstimate;

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Text(
          'Logistics & Freight',
          style: TextStyle(color: textWhite, fontWeight: FontWeight.bold),
        ),
        elevation: 0,
        backgroundColor: const Color(0xFF050505),
        foregroundColor: textWhite,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header info pill
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: const Color(0xFF3A290A),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: logisticsOrange.withValues(alpha: 0.4),
                ),
              ),
              child: Row(
                children: const [
                  const Icon(
                    Icons.local_shipping_rounded,
                    color: logisticsOrange,
                    size: 24,
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      'On-demand intra-city freight with live GPS tracking and verified cargo drivers.',
                      style: TextStyle(
                        color: textWhite,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Route addresses
            const Text(
              'Pickup & Delivery Location',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: textWhite,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: borderCard),
              ),
              child: Column(
                children: [
                  Column(
                    children: [
                      Row(
                        children: [
                          const Icon(
                            Icons.upload_rounded,
                            color: brandGreen,
                            size: 20,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextField(
                              controller: _pickupController,
                              style: const TextStyle(color: textWhite),
                              decoration: const InputDecoration(
                                hintText:
                                    'Pickup Address (Warehouse / Shop / Home)',
                                hintStyle: TextStyle(color: textGray),
                                border: InputBorder.none,
                                isDense: true,
                              ),
                              onChanged: (query) => _onLocationQueryChanged(
                                query,
                                isPickup: true,
                              ),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(
                              Icons.gps_fixed_rounded,
                              size: 18,
                              color: brandGreen,
                            ),
                            onPressed: _detectCurrentLocation,
                          ),
                        ],
                      ),
                      _buildLocationSuggestions(isPickup: true),
                    ],
                  ),
                  const Divider(height: 16, color: borderCard),
                  Column(
                    children: [
                      Row(
                        children: [
                          const Icon(
                            Icons.download_rounded,
                            color: logisticsOrange,
                            size: 20,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextField(
                              controller: _dropController,
                              style: const TextStyle(color: textWhite),
                              decoration: const InputDecoration(
                                hintText: 'Delivery Destination Address',
                                hintStyle: TextStyle(color: textGray),
                                border: InputBorder.none,
                                isDense: true,
                              ),
                              onChanged: (query) => _onLocationQueryChanged(
                                query,
                                isPickup: false,
                              ),
                            ),
                          ),
                        ],
                      ),
                      _buildLocationSuggestions(isPickup: false),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Vehicle Category Selector
            const Text(
              'Select Freight Vehicle',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: textWhite,
              ),
            ),
            const SizedBox(height: 12),
            if (_isLoadingVehicles)
              const Center(child: CircularProgressIndicator())
            else if (_fleetVehicles.isEmpty)
              Column(
                children: [
                  const Text(
                    'No active, approved freight vehicles are available.',
                    style: TextStyle(color: textGray),
                  ),
                  TextButton(
                    onPressed: _fetchFleet,
                    child: const Text('Retry'),
                  ),
                ],
              )
            else
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final vehicle in _fleetVehicles) ...[
                      _buildVehicleOption(vehicle),
                      if (vehicle != _fleetVehicles.last)
                        const SizedBox(width: 10),
                    ],
                  ],
                ),
              ),
            const SizedBox(height: 24),

            // Item Details
            const Text(
              'Cargo & Parcel Information',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: textWhite,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: cardBg,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: borderCard),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: _selectedCategory,
                    dropdownColor: cardBg,
                    style: const TextStyle(color: textWhite),
                    decoration: const InputDecoration(
                      labelText: 'Item Category',
                      labelStyle: TextStyle(color: textGray),
                      border: OutlineInputBorder(),
                      enabledBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: borderCard),
                      ),
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                    ),
                    items: _categories
                        .map(
                          (c) => DropdownMenuItem(
                            value: c,
                            child: Text(
                              c,
                              style: const TextStyle(
                                fontSize: 14,
                                color: textWhite,
                              ),
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (val) {
                      if (val != null) {
                        setState(() => _selectedCategory = val);
                        _recalculateFare();
                      }
                    },
                  ),
                  const SizedBox(height: 14),
                  InfurnusTextField(
                    label: 'Goods Description',
                    hintText: 'e.g. 2 boxes of fragile glassware',
                    controller: _itemDescController,
                    onChanged: (_) => _recalculateFare(),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: InfurnusTextField(
                          label: 'Estimated Weight (kg)',
                          hintText: 'e.g. 45',
                          keyboardType: TextInputType.number,
                          controller: _weightController,
                          onChanged: (_) => _recalculateFare(),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: InfurnusTextField(
                          label: 'Quantity / Units',
                          hintText: 'e.g. 2',
                          keyboardType: TextInputType.number,
                          controller: _quantityController,
                          onChanged: (_) => _recalculateFare(),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'Driver Loading & Unloading Help',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: textWhite,
                      ),
                    ),
                    subtitle: const Text(
                      'Helper assistance for heavy goods (server rate applies)',
                      style: TextStyle(fontSize: 12, color: textGray),
                    ),
                    value: _needLoadingHelper,
                    activeThumbColor: brandGreen,
                    onChanged: (val) {
                      setState(() => _needLoadingHelper = val);
                      _recalculateFare();
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Itemized Fare Breakdown Card
            const Text(
              'Itemized Fare Breakdown',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: textWhite,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: borderCard),
              ),
              child: Column(
                children: [
                  if (estimate == null) ...[
                    _buildFareRow('Status', 'Fare estimate calculating...'),
                  ] else ...[
                    _buildFareRow(
                      'Base Logistics Charge',
                      '₹${estimate.baseAmount.toStringAsFixed(2)}',
                    ),
                    const SizedBox(height: 6),
                    _buildFareRow(
                      'Distance Charge (${estimate.distanceKm.toStringAsFixed(1)} km)',
                      '₹${estimate.distanceAmount.toStringAsFixed(2)}',
                    ),
                    if ((estimate.weightAmount ?? 0) > 0) ...[
                      const SizedBox(height: 6),
                      _buildFareRow(
                        'Weight Surcharge (>20kg)',
                        '₹${estimate.weightAmount!.toStringAsFixed(2)}',
                      ),
                    ],
                    if (_needLoadingHelper &&
                        (estimate.loadingAmount ?? 0) > 0) ...[
                      const SizedBox(height: 6),
                      _buildFareRow(
                        'Loading/Unloading Helper',
                        '₹${estimate.loadingAmount!.toStringAsFixed(2)}',
                      ),
                    ],
                    if ((estimate.taxAmount ?? 0) > 0) ...[
                      const SizedBox(height: 6),
                      _buildFareRow(
                        'Goods & Service Tax (5% GST)',
                        '₹${estimate.taxAmount!.toStringAsFixed(2)}',
                      ),
                    ],
                  ],
                  const Divider(height: 20, color: borderCard),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total Estimated Fare',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color: textWhite,
                        ),
                      ),
                      Text(
                        rideState.fare != null
                            ? '₹${rideState.fare!.toStringAsFixed(2)}'
                            : (estimate != null
                                  ? '₹${estimate.grossAmount.toStringAsFixed(2)}'
                                  : '--'),
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 20,
                          color: brandGreen,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // Book Button
            InfurnusButton(
              text: rideState.fare != null
                  ? 'Book Logistics Delivery • ₹${rideState.fare!.toStringAsFixed(0)}'
                  : 'Book Logistics Delivery',
              isLoading: rideState.isEstimatingFare || _isSubmittingBooking,
              onPressed: _handleBooking,
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildVehicleOption(FleetVehicleModel vehicle) {
    final isSelected = _selectedVehicle == vehicle.category;

    return GestureDetector(
      onTap: () {
        setState(() => _selectedVehicle = vehicle.category);
        _recalculateFare();
      },
      child: Container(
        width: 125,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFF3A290A) : cardBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? logisticsOrange : borderCard,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Icon(
              Icons.local_shipping_rounded,
              size: 28,
              color: isSelected ? logisticsOrange : textGray,
            ),
            const SizedBox(height: 6),
            Text(
              vehicle.displayName,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: textWhite,
              ),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              vehicle.loadCapacityKg > 0
                  ? '${vehicle.loadCapacityKg} kg capacity'
                  : vehicle.category,
              style: const TextStyle(fontSize: 10, color: textGray),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFareRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: textGray, fontSize: 13)),
        Text(
          value,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 13,
            color: textWhite,
          ),
        ),
      ],
    );
  }
}
