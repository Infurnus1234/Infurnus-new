import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../../core/services/location_service.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_map.dart';
import '../../../../shared/widgets/infurnus_outlined_button.dart';
import '../../data/models/fleet_vehicle_model.dart';
import '../providers/ride_provider.dart';
import '../providers/ride_use_case_providers.dart';

class RideBookingScreen extends ConsumerStatefulWidget {
  const RideBookingScreen({super.key});

  @override
  ConsumerState<RideBookingScreen> createState() => _RideBookingScreenState();
}

class _RideBookingScreenState extends ConsumerState<RideBookingScreen> {
  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color cardElevated = Color(0xFF151515);
  static const Color borderCard = Color(0xFF262626);
  static const Color borderSearch = Color(0xFF292929);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color brandGreen = Color(0xFF22C55E);
  static const Color serviceRed = Color(0xFFEF4444);
  static const Color premiumBlue = Color(0xFF3B82F6);
  static const Color goldAccent = Color(0xFFFACC15);

  final _pickupController = TextEditingController();
  final _destinationController = TextEditingController();
  final _reviewController = TextEditingController();
  final _serviceNotesController = TextEditingController();
  int _selectedRating = 5;
  String _selectedPaymentMethod = 'wallet';
  bool _isProcessingPayment = false;
  List<FleetVehicleModel> _premiumFleet = [];

  final List<Map<String, dynamic>> _quickDestinations = [
    {
      'label': 'Airport T1',
      'icon': Icons.flight_rounded,
      'address': 'Airport Terminal 1, International Hub',
      'coords': const LatLng(12.9716, 77.6946),
    },
    {
      'label': 'Tech Park',
      'icon': Icons.business_rounded,
      'address': 'EcoWorld Tech Park, Block 4',
      'coords': const LatLng(12.9352, 77.6944),
    },
    {
      'label': 'Central Railway',
      'icon': Icons.train_rounded,
      'address': 'Central Railway Station Platform 1',
      'coords': const LatLng(12.9781, 77.5696),
    },
    {
      'label': 'City Hospital',
      'icon': Icons.local_hospital_rounded,
      'address': 'Manipal Hospital, HAL Airport Rd',
      'coords': const LatLng(12.9582, 77.6534),
    },
  ];

  @override
  void initState() {
    super.initState();
    final rideState = ref.read(rideProvider);
    _pickupController.text = rideState.pickup ?? '';
    _destinationController.text = rideState.destination ?? '';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _detectCurrentLocation();
      _fetchPremiumFleet();
    });
  }

  Future<void> _fetchPremiumFleet() async {
    try {
      final fleet = await ref.read(getFleetUseCaseProvider)(sector: 'premium');
      if (mounted) {
        setState(() => _premiumFleet = fleet);
      }
    } catch (_) {}
  }

  Future<void> _detectCurrentLocation() async {
    try {
      final pos = await ref.read(locationServiceProvider).getCurrentPosition();
      if (pos != null && mounted) {
        if (_pickupController.text.isEmpty) {
          _pickupController.text = 'Current Location';
        }
        ref
            .read(rideProvider.notifier)
            .setPickupCoords(
              LatLng(pos.latitude, pos.longitude),
              address: 'Current Location',
            );
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _pickupController.dispose();
    _destinationController.dispose();
    _reviewController.dispose();
    _serviceNotesController.dispose();
    super.dispose();
  }

  void _handleBooking() async {
    final pickupText = _pickupController.text.trim();
    final destText = _destinationController.text.trim();

    if (pickupText.isEmpty || destText.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter pickup and destination')),
      );
      return;
    }

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

    ref.read(rideProvider.notifier).requestRide();
  }

  String _getFuelNoticeText(RideState state) {
    final rentalFuelRate = state.rentalDetails?['fuelRatePerKm'] as num?;
    if (rentalFuelRate != null && rentalFuelRate > 0) {
      return 'Actual distance fuel billed separately @ ₹${rentalFuelRate.toStringAsFixed(0)}/km';
    }
    final vehicle = _premiumFleet
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
                    state.fare != null
                        ? '₹${state.fare!.toStringAsFixed(2)}'
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

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: Text(
          rideState.selectedSector == 'service'
              ? 'Emergency & Service Vehicle'
              : (rideState.selectedSector == 'premium'
                    ? 'Premium Vehicle'
                    : (rideState.selectedSector == 'logistics'
                          ? 'Logistics Booking'
                          : 'Book a Ride')),
          style: const TextStyle(color: textWhite, fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF050505),
        foregroundColor: textWhite,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            if (rideState.status == RideStatus.completed) {
              ref.read(rideProvider.notifier).resetRide();
            }
            context.pop();
          },
        ),
      ),
      body: Stack(
        children: [
          // 1. Google Map
          InfurnusMap(
            pickup: pickupLatLng,
            destination: destinationLatLng,
            driverLocation: rideState.lastDriverLocation,
            route: rideState.currentRoute,
          ),

          // 2. Dynamic Bottom Panel
          Align(
            alignment: Alignment.bottomCenter,
            child: SingleChildScrollView(
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: cardBg,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(24),
                  ),
                  border: const Border(
                    top: BorderSide(color: borderCard, width: 1.0),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.6),
                      blurRadius: 16,
                      offset: const Offset(0, -4),
                    ),
                  ],
                ),
                child: _buildPanelContent(rideState),
              ),
            ),
          ),
        ],
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
        if (state.errorMessage != null) _buildErrorBanner(state.errorMessage!),

        // Route Inputs
        _buildRouteInputs(),
        const SizedBox(height: 12),

        // Quick Destination Chips
        SizedBox(
          height: 36,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _quickDestinations.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final item = _quickDestinations[index];
              return ActionChip(
                avatar: Icon(
                  item['icon'] as IconData,
                  size: 16,
                  color: brandGreen,
                ),
                label: Text(
                  item['label'] as String,
                  style: const TextStyle(fontSize: 12, color: textWhite),
                ),
                backgroundColor: cardElevated,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: const BorderSide(color: borderCard),
                ),
                onPressed: () {
                  _destinationController.text = item['address'] as String;
                  ref
                      .read(rideProvider.notifier)
                      .setDestinationCoords(
                        item['coords'] as LatLng,
                        address: item['address'] as String,
                      );
                },
              );
            },
          ),
        ),
        const SizedBox(height: 16),

        // 4 Official Sectors
        const Text(
          'Choose Mobility Sector',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 14,
            color: textWhite,
          ),
        ),
        const SizedBox(height: 8),
        _buildSectorSelector(state),
        const SizedBox(height: 14),

        // Vehicle Category Cards
        _buildVehicleTierCards(state),
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
        if (state.distanceKm != null && state.durationMinutes != null)
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

        // Confirm CTA
        InfurnusButton(
          text: state.fare != null
              ? 'Confirm Booking • ₹${state.fare!.toStringAsFixed(0)}'
              : 'Confirm Booking',
          isLoading: state.isEstimatingFare,
          onPressed: _handleBooking,
        ),
      ],
    );
  }

  Widget _buildRouteInputs() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: cardElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCard),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(
                Icons.my_location_rounded,
                color: brandGreen,
                size: 20,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _pickupController,
                  style: const TextStyle(color: textWhite),
                  decoration: const InputDecoration(
                    hintText: 'Pickup Location',
                    hintStyle: TextStyle(color: textGray),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(vertical: 8),
                  ),
                  onSubmitted: (val) async {
                    final query = val.trim();
                    if (query.isEmpty) return;
                    final success = await ref
                        .read(rideProvider.notifier)
                        .geocodeAndSetPickup(query);
                    if (!success && mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Could not locate "$query". Please check the address.',
                          ),
                          backgroundColor: serviceRed,
                        ),
                      );
                    }
                  },
                ),
              ),
              IconButton(
                icon: const Icon(
                  Icons.gps_fixed_rounded,
                  size: 18,
                  color: brandGreen,
                ),
                tooltip: 'Current GPS',
                onPressed: _detectCurrentLocation,
              ),
            ],
          ),
          const Divider(height: 1, color: borderCard),
          Row(
            children: [
              const Icon(
                Icons.location_on_rounded,
                color: serviceRed,
                size: 20,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _destinationController,
                  style: const TextStyle(color: textWhite),
                  decoration: const InputDecoration(
                    hintText: 'Destination',
                    hintStyle: TextStyle(color: textGray),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(vertical: 8),
                  ),
                  onSubmitted: (val) async {
                    final query = val.trim();
                    if (query.isEmpty) return;
                    final success = await ref
                        .read(rideProvider.notifier)
                        .geocodeAndSetDestination(query);
                    if (!success && mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Could not locate "$query". Please check the address.',
                          ),
                          backgroundColor: serviceRed,
                        ),
                      );
                    }
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSectorSelector(RideState state) {
    final sectors = [
      {
        'id': 'passenger',
        'label': 'Passenger',
        'icon': Icons.directions_car_rounded,
      },
      {
        'id': 'logistics',
        'label': 'Logistics',
        'icon': Icons.local_shipping_rounded,
      },
      {
        'id': 'service',
        'label': 'Service Vehicle',
        'icon': Icons.emergency_rounded,
      },
      {'id': 'premium', 'label': 'Premium', 'icon': Icons.stars_rounded},
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: sectors.map((sec) {
          final isSelected = state.selectedSector == sec['id'];
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              avatar: Icon(
                sec['icon'] as IconData,
                size: 16,
                color: isSelected ? Colors.black : textGray,
              ),
              label: Text(sec['label'] as String),
              selected: isSelected,
              selectedColor: brandGreen,
              backgroundColor: cardElevated,
              labelStyle: TextStyle(
                color: isSelected ? Colors.black : textWhite,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                fontSize: 12,
              ),
              onSelected: (_) {
                ref
                    .read(rideProvider.notifier)
                    .selectSector(sec['id'] as String);
              },
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildVehicleTierCards(RideState state) {
    List<Map<String, dynamic>> tiers = [];

    if (state.selectedSector == 'passenger') {
      tiers = [
        {
          'id': 'bike',
          'name': 'Bike Taxi',
          'icon': Icons.two_wheeler_rounded,
          'eta': '3m',
        },
        {
          'id': 'auto',
          'name': 'Auto',
          'icon': Icons.electric_rickshaw_rounded,
          'eta': '3m',
        },
        {
          'id': 'mini',
          'name': 'Mini/Compact',
          'icon': Icons.directions_car_rounded,
          'eta': '4m',
        },
        {
          'id': 'sedan',
          'name': 'Prime Sedan',
          'icon': Icons.airport_shuttle_rounded,
          'eta': '2m',
        },
        {
          'id': 'suv',
          'name': 'SUV 6-Seater',
          'icon': Icons.directions_bus_rounded,
          'eta': '6m',
        },
      ];
    } else if (state.selectedSector == 'logistics') {
      tiers = [
        {
          'id': 'bike',
          'name': 'Bike Express',
          'icon': Icons.two_wheeler_rounded,
          'eta': '5m',
        },
        {
          'id': 'three_wheeler',
          'name': '3-Wheeler',
          'icon': Icons.electric_rickshaw_rounded,
          'eta': '8m',
        },
        {
          'id': 'mini_truck',
          'name': 'Mini Truck 1T',
          'icon': Icons.local_shipping_rounded,
          'eta': '10m',
        },
      ];
    } else if (state.selectedSector == 'service') {
      tiers = [
        {
          'id': 'ambulance',
          'name': 'Ambulance',
          'icon': Icons.medical_services_rounded,
          'eta': 'Priority',
        },
        {
          'id': 'towing',
          'name': 'Towing Van',
          'icon': Icons.car_repair_rounded,
          'eta': '12m',
        },
        {
          'id': 'jcb',
          'name': 'JCB Excavator',
          'icon': Icons.agriculture_rounded,
          'eta': 'Scheduled',
        },
        {
          'id': 'recovery',
          'name': 'Recovery Vehicle',
          'icon': Icons.rv_hookup_rounded,
          'eta': '15m',
        },
        {
          'id': 'roadside_service',
          'name': 'Roadside Service',
          'icon': Icons.build_rounded,
          'eta': '15m',
        },
      ];
    } else if (state.selectedSector == 'premium') {
      tiers = [
        {
          'id': 'fortuner',
          'name': 'Toyota Fortuner',
          'icon': Icons.directions_car_filled_rounded,
          'eta': 'Chauffeur',
        },
        {
          'id': 'thar',
          'name': 'Mahindra Thar',
          'icon': Icons.terrain_rounded,
          'eta': 'Standby',
        },
        {
          'id': 'luxury_suv',
          'name': 'BMW/Mercedes SUV',
          'icon': Icons.stars_rounded,
          'eta': 'VIP',
        },
      ];
    }

    return SizedBox(
      height: 95,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: tiers.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final tier = tiers[index];
          final isSelected = state.selectedTier == tier['id'];
          final String displayPriceText;
          if (isSelected) {
            if (state.isEstimatingFare) {
              displayPriceText = '...';
            } else if (state.fare != null) {
              displayPriceText = '₹${state.fare!.toStringAsFixed(0)}';
            } else {
              displayPriceText = 'View Est.';
            }
          } else {
            displayPriceText = 'Select';
          }

          return GestureDetector(
            onTap: () {
              ref.read(rideProvider.notifier).selectTier(tier['id'] as String);
            },
            child: Container(
              width: 120,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: isSelected ? const Color(0xFF12351F) : cardElevated,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: isSelected ? brandGreen : borderCard,
                  width: isSelected ? 2 : 1,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Icon(
                        tier['icon'] as IconData,
                        size: 22,
                        color: isSelected ? brandGreen : textGray,
                      ),
                      Text(
                        tier['eta'] as String,
                        style: const TextStyle(fontSize: 10, color: textGray),
                      ),
                    ],
                  ),
                  Text(
                    tier['name'] as String,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                      color: textWhite,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    displayPriceText,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: isSelected ? brandGreen : textWhite,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
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
          'Matching in ${state.selectedSector.toUpperCase()} sector • Fare ₹${state.fare?.toStringAsFixed(0) ?? "---"}',
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
                          : (state.driverName ?? 'Assigned Driver'),
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
                                'Vehicle details pending assignment'),
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
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Calling ${driver?.name ?? "driver"}...'),
                    ),
                  );
                },
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
        const SizedBox(height: 14),

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
