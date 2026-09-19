import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/theme/app_colors.dart';
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
  final _pickupController = TextEditingController();
  final _destinationController = TextEditingController();
  final _reviewController = TextEditingController();
  final _serviceNotesController = TextEditingController();
  int _selectedRating = 5;
  String _selectedPaymentMethod = 'wallet'; // 'wallet', 'upi', 'card', 'cash'
  bool _isProcessingPayment = false;
  List<FleetVehicleModel> _premiumFleet = [];

  final List<Map<String, dynamic>> _quickDestinations = [
    {
      'label': 'Airport T1',
      'icon': Icons.flight,
      'address': 'Airport Terminal 1, International Hub',
      'coords': const LatLng(12.9716, 77.6946),
    },
    {
      'label': 'Tech Park',
      'icon': Icons.business,
      'address': 'EcoWorld Tech Park, Block 4',
      'coords': const LatLng(12.9352, 77.6944),
    },
    {
      'label': 'Central Railway',
      'icon': Icons.train,
      'address': 'Central Railway Station Platform 1',
      'coords': const LatLng(12.9781, 77.5696),
    },
    {
      'label': 'City Hospital',
      'icon': Icons.local_hospital,
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
        ref.read(rideProvider.notifier).setPickupCoords(
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
      final success = await ref.read(rideProvider.notifier).geocodeAndSetPickup(pickupText);
      if (!success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not locate pickup "$pickupText". Please check the address.'),
            backgroundColor: Colors.red[700],
          ),
        );
        return;
      }
    }

    if (ref.read(rideProvider).destinationCoords == null) {
      final success = await ref.read(rideProvider.notifier).geocodeAndSetDestination(destText);
      if (!success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not locate destination "$destText". Please check the address.'),
            backgroundColor: Colors.red[700],
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
    final vehicle = _premiumFleet.where((v) => v.category == state.selectedTier).firstOrNull;
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
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
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
                        : (isPremium ? 'Premium Standby Estimate' : 'Itemized Fare Breakdown'),
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
                ],
              ),
              const SizedBox(height: 14),
              if (estimate == null) ...[
                _buildBreakdownRow('Status', 'Fare estimate calculating...'),
              ] else if (isService) ...[
                _buildBreakdownRow('Base Mobilization / Dispatch', '₹${estimate.baseAmount.toStringAsFixed(2)}'),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Service & Transit Charge (${estimate.distanceKm.toStringAsFixed(1)} km)',
                  '₹${estimate.distanceAmount.toStringAsFixed(2)}',
                ),
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow('Taxes & Regulatory Fees (5% GST)', '₹${estimate.taxAmount!.toStringAsFixed(2)}'),
                ],
                const SizedBox(height: 8),
                Text(
                  'Note: Service Vehicle is strictly trip & service based (no hourly rentals).',
                  style: TextStyle(fontSize: 11, color: Colors.grey[600], fontStyle: FontStyle.italic),
                ),
              ] else if (isPremium) ...[
                _buildBreakdownRow('Chauffeur Standby Package Base', '₹${estimate.baseAmount.toStringAsFixed(2)}'),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Standby Duration Charge (~${estimate.durationMinutes} mins)',
                  '₹${estimate.timeAmount.toStringAsFixed(2)}',
                ),
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow('Taxes & Regulatory Fees (5% GST)', '₹${estimate.taxAmount!.toStringAsFixed(2)}'),
                ],
                const SizedBox(height: 8),
                Text(
                  'Note: Actual GPS distance fuel cost will be reconciled post-trip.',
                  style: TextStyle(fontSize: 11, color: Colors.grey[600], fontStyle: FontStyle.italic),
                ),
              ] else if (isLogistics) ...[
                _buildBreakdownRow('Base Logistics Charge', '₹${estimate.baseAmount.toStringAsFixed(2)}'),
                const SizedBox(height: 8),
                _buildBreakdownRow(
                  'Distance Charge (${estimate.distanceKm.toStringAsFixed(1)} km)',
                  '₹${estimate.distanceAmount.toStringAsFixed(2)}',
                ),
                if ((estimate.weightAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow('Weight Surcharge', '₹${estimate.weightAmount!.toStringAsFixed(2)}'),
                ],
                if ((estimate.loadingAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow('Loading/Unloading Helper', '₹${estimate.loadingAmount!.toStringAsFixed(2)}'),
                ],
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow('Taxes & Regulatory Fees (5% GST)', '₹${estimate.taxAmount!.toStringAsFixed(2)}'),
                ],
              ] else ...[
                _buildBreakdownRow('Base Fare', '₹${estimate.baseAmount.toStringAsFixed(2)}'),
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
                  _buildBreakdownRow('Waiting Charge (>3 min)', '₹${estimate.waitingAmount!.toStringAsFixed(2)}'),
                ],
                if ((estimate.taxAmount ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  _buildBreakdownRow('Taxes & Regulatory Fees (5% GST)', '₹${estimate.taxAmount!.toStringAsFixed(2)}'),
                ],
              ],
              const Divider(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    isPremium ? 'Total Booking Advance' : 'Total Fare',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  Text(
                    state.fare != null
                        ? '₹${state.fare!.toStringAsFixed(2)}'
                        : (estimate != null ? '₹${estimate.grossAmount.toStringAsFixed(2)}' : '--'),
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: AppColors.primaryGreen),
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
        Text(label, style: TextStyle(color: Colors.grey[700], fontSize: 14)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);

    final pickupLatLng = rideState.currentRide != null
        ? LatLng(rideState.currentRide!.pickup.latitude, rideState.currentRide!.pickup.longitude)
        : rideState.pickupCoords;

    final destinationLatLng = rideState.currentRide != null
        ? LatLng(rideState.currentRide!.destination.latitude, rideState.currentRide!.destination.longitude)
        : rideState.destinationCoords;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          rideState.selectedSector == 'service'
              ? 'Emergency & Service Vehicle'
              : (rideState.selectedSector == 'premium'
                  ? 'Premium Vehicle'
                  : (rideState.selectedSector == 'logistics' ? 'Logistics Booking' : 'Book a Ride')),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
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
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black12,
                      blurRadius: 16,
                      offset: Offset(0, -4),
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
        return _buildDriverAssignedPanel(rideState, 'Driver Assigned & Heading to You');

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
                avatar: Icon(item['icon'] as IconData, size: 16, color: AppColors.primaryGreen),
                label: Text(item['label'] as String, style: const TextStyle(fontSize: 12)),
                backgroundColor: Colors.grey[50],
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: BorderSide(color: Colors.grey[300]!),
                ),
                onPressed: () {
                  _destinationController.text = item['address'] as String;
                  ref.read(rideProvider.notifier).setDestinationCoords(
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
        const Text('Choose Mobility Sector', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
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
              color: Colors.red[50],
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.red[200]!),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.emergency, color: Colors.red, size: 18),
                    SizedBox(width: 8),
                    Text('Emergency & Special Dispatch', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 13)),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _serviceNotesController,
                  decoration: const InputDecoration(
                    hintText: 'Emergency triage / breakdown reason (e.g. cardiac patient, flat tire, site work)',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
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
              color: Colors.amber[50],
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.amber[200]!),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Chauffeur Standby Package', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                    Text(_getFuelNoticeText(state), style: const TextStyle(fontSize: 11, color: Colors.black54)),
                  ],
                ),
                GestureDetector(
                  onTap: () => context.push('/rentals'),
                  child: const Text('Configure >', style: TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 12)),
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
              color: Colors.grey[100],
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.straighten, size: 16, color: Colors.grey),
                    const SizedBox(width: 6),
                    Text(
                      '${state.distanceKm!.toStringAsFixed(1)} km',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Row(
                  children: [
                    const Icon(Icons.access_time, size: 16, color: Colors.grey),
                    const SizedBox(width: 6),
                    Text(
                      '~${state.durationMinutes} mins',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                GestureDetector(
                  onTap: () => _showFareBreakdownSheet(state),
                  child: const Row(
                    children: [
                      Icon(Icons.info_outline, size: 16, color: AppColors.primaryGreen),
                      SizedBox(width: 4),
                      Text('Breakdown', style: TextStyle(fontSize: 12, color: AppColors.primaryGreen, fontWeight: FontWeight.bold)),
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
        color: Colors.grey[50],
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey[200]!),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.my_location, color: AppColors.primaryGreen, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _pickupController,
                  decoration: const InputDecoration(
                    hintText: 'Pickup Location',
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(vertical: 8),
                  ),
                  onSubmitted: (val) async {
                    final query = val.trim();
                    if (query.isEmpty) return;
                    final success = await ref.read(rideProvider.notifier).geocodeAndSetPickup(query);
                    if (!success && mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Could not locate "$query". Please check the address.'),
                          backgroundColor: Colors.red[700],
                        ),
                      );
                    }
                  },
                ),
              ),
              IconButton(
                icon: const Icon(Icons.gps_fixed, size: 18, color: AppColors.primaryGreen),
                tooltip: 'Current GPS',
                onPressed: _detectCurrentLocation,
              ),
            ],
          ),
          const Divider(height: 1),
          Row(
            children: [
              const Icon(Icons.location_on, color: Colors.red, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _destinationController,
                  decoration: const InputDecoration(
                    hintText: 'Destination',
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(vertical: 8),
                  ),
                  onSubmitted: (val) async {
                    final query = val.trim();
                    if (query.isEmpty) return;
                    final success = await ref.read(rideProvider.notifier).geocodeAndSetDestination(query);
                    if (!success && mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Could not locate "$query". Please check the address.'),
                          backgroundColor: Colors.red[700],
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
      {'id': 'passenger', 'label': 'Passenger', 'icon': Icons.directions_car},
      {'id': 'logistics', 'label': 'Logistics', 'icon': Icons.local_shipping},
      {'id': 'service', 'label': 'Service Vehicle', 'icon': Icons.emergency},
      {'id': 'premium', 'label': 'Premium', 'icon': Icons.stars},
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
                color: isSelected ? Colors.white : AppColors.primaryDark,
              ),
              label: Text(sec['label'] as String),
              selected: isSelected,
              selectedColor: AppColors.primaryDark,
              backgroundColor: Colors.grey[100],
              labelStyle: TextStyle(
                color: isSelected ? Colors.white : Colors.black87,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                fontSize: 12,
              ),
              onSelected: (_) {
                ref.read(rideProvider.notifier).selectSector(sec['id'] as String);
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
        {'id': 'bike', 'name': 'Bike Taxi', 'icon': Icons.two_wheeler, 'eta': '3m'},
        {'id': 'auto', 'name': 'Auto', 'icon': Icons.electric_rickshaw, 'eta': '3m'},
        {'id': 'mini', 'name': 'Mini/Compact', 'icon': Icons.directions_car, 'eta': '4m'},
        {'id': 'sedan', 'name': 'Prime Sedan', 'icon': Icons.airport_shuttle, 'eta': '2m'},
        {'id': 'suv', 'name': 'SUV 6-Seater', 'icon': Icons.directions_bus, 'eta': '6m'},
      ];
    } else if (state.selectedSector == 'logistics') {
      tiers = [
        {'id': 'bike', 'name': 'Bike Express', 'icon': Icons.two_wheeler, 'eta': '5m'},
        {'id': 'three_wheeler', 'name': '3-Wheeler', 'icon': Icons.electric_rickshaw, 'eta': '8m'},
        {'id': 'mini_truck', 'name': 'Mini Truck 1T', 'icon': Icons.local_shipping, 'eta': '10m'},
      ];
    } else if (state.selectedSector == 'service') {
      tiers = [
        {'id': 'ambulance', 'name': 'Ambulance', 'icon': Icons.medical_services, 'eta': 'Priority'},
        {'id': 'towing', 'name': 'Towing Van', 'icon': Icons.car_repair, 'eta': '12m'},
        {'id': 'jcb', 'name': 'JCB Excavator', 'icon': Icons.agriculture, 'eta': 'Scheduled'},
        {'id': 'recovery', 'name': 'Recovery Vehicle', 'icon': Icons.rv_hookup, 'eta': '15m'},
        {'id': 'roadside_service', 'name': 'Roadside Service', 'icon': Icons.build, 'eta': '15m'},
      ];
    } else if (state.selectedSector == 'premium') {
      tiers = [
        {'id': 'fortuner', 'name': 'Toyota Fortuner', 'icon': Icons.directions_car_filled, 'eta': 'Chauffeur'},
        {'id': 'thar', 'name': 'Mahindra Thar', 'icon': Icons.terrain, 'eta': 'Standby'},
        {'id': 'luxury_suv', 'name': 'BMW/Mercedes SUV', 'icon': Icons.stars, 'eta': 'VIP'},
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
                color: isSelected ? Colors.green[50] : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isSelected ? AppColors.primaryGreen : Colors.grey[200]!,
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
                        color: isSelected ? AppColors.primaryGreen : Colors.grey[700],
                      ),
                      Text(
                        tier['eta'] as String,
                        style: TextStyle(fontSize: 10, color: Colors.grey[600]),
                      ),
                    ],
                  ),
                  Text(
                    tier['name'] as String,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    displayPriceText,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: isSelected ? AppColors.primaryGreen : Colors.black87,
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
            color: AppColors.primaryGreen.withValues(alpha: 0.15),
            shape: BoxShape.circle,
          ),
          child: const Center(
            child: SizedBox(
              width: 42,
              height: 42,
              child: CircularProgressIndicator(
                strokeWidth: 3,
                color: AppColors.primaryGreen,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Connecting to nearby drivers...',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 6),
        Text(
          'Matching in ${state.selectedSector.toUpperCase()} sector • Fare ₹${state.fare?.toStringAsFixed(0) ?? "---"}',
          style: TextStyle(color: Colors.grey[600], fontSize: 13),
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
                Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const Text(
                  'ETA: ~3 mins away',
                  style: TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ],
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.primaryGreen.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text('MATCHED', style: TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.bold, fontSize: 11)),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // Driver Card
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.grey[50],
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.grey[200]!),
          ),
          child: Row(
            children: [
              const CircleAvatar(
                radius: 26,
                backgroundColor: AppColors.primaryDark,
                child: Icon(Icons.person, color: Colors.white, size: 28),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      driver?.name.isNotEmpty == true ? driver!.name : (state.driverName ?? 'Assigned Driver'),
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        if (driver?.rating != null) ...[
                          const Icon(Icons.star, color: Colors.amber, size: 14),
                          const SizedBox(width: 4),
                          Text(
                            '${driver!.rating!.toStringAsFixed(1)} • Verified Driver',
                            style: TextStyle(color: Colors.grey[600], fontSize: 12),
                          ),
                        ] else ...[
                          const Icon(Icons.verified, color: AppColors.primaryGreen, size: 14),
                          const SizedBox(width: 4),
                          Text(
                            'Verified Driver',
                            style: TextStyle(color: Colors.grey[600], fontSize: 12),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      vehicle != null && vehicle.make.isNotEmpty
                          ? '${vehicle.make} ${vehicle.model} • ${vehicle.plateNumber}'
                          : (state.vehicleInfo ?? 'Vehicle details pending assignment'),
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12, color: AppColors.primaryDark),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.phone, color: AppColors.primaryGreen),
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Calling ${driver?.name ?? "driver"}...')),
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
              color: AppColors.primaryDark,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Pickup PIN (share with driver):', style: TextStyle(color: Colors.white70, fontSize: 13)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.primaryGreen,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    ride!.pin!,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 2),
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
                    const SnackBar(content: Text('Live trip details shared with emergency contacts')),
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
            color: Colors.green[50],
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.green[200]!),
          ),
          child: const Row(
            children: [
              Icon(Icons.check_circle, color: AppColors.primaryGreen),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Driver has arrived at your pickup spot!',
                  style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.primaryGreen),
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
            color: AppColors.primaryDark,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Share PIN with Driver:', style: TextStyle(color: Colors.white70, fontSize: 13)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primaryGreen,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  state.currentRide?.pin ?? '----',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 2),
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
                Icon(Icons.navigation, color: AppColors.primaryGreen, size: 20),
                SizedBox(width: 8),
                Text('Trip in Progress', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.blue[50],
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text('ON ROUTE', style: TextStyle(color: Colors.blue, fontWeight: FontWeight.bold, fontSize: 11)),
            ),
          ],
        ),
        const SizedBox(height: 14),

        Text(
          'Destination: ${state.destination ?? "Destination"}',
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 4),
        Text(
          'Live tracking active • Estimated arrival in ~${state.durationMinutes ?? 18} mins',
          style: TextStyle(color: Colors.grey[600], fontSize: 12),
        ),
        const SizedBox(height: 16),

        Row(
          children: [
            Expanded(
              child: ElevatedButton.icon(
                icon: const Icon(Icons.shield_outlined, color: Colors.white, size: 18),
                label: const Text('Emergency SOS'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red[700],
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
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
              color: Colors.green[50],
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.check_circle, size: 48, color: AppColors.primaryGreen),
          ),
        ),
        const SizedBox(height: 12),
        const Center(
          child: Text('You have arrived! 🎉', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
        ),
        const SizedBox(height: 4),
        Center(
          child: Text(
            isPremium ? 'Premium trip reconciled & completed' : 'Trip completed successfully',
            style: TextStyle(color: Colors.grey[600], fontSize: 13),
          ),
        ),
        const SizedBox(height: 16),

        // Fare Summary Card
        InfurnusCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (isPremium) ...[
                const Row(
                  children: [
                    Icon(Icons.receipt_long, color: AppColors.primaryDark, size: 18),
                    SizedBox(width: 8),
                    Text(
                      'Final Reconciled Bill',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                _buildBreakdownRow(
                  'Booking Estimate',
                  ride?.fareEstimate != null ? '₹${ride!.fareEstimate!.toStringAsFixed(2)}' : '--',
                ),
                const SizedBox(height: 6),
                _buildBreakdownRow(
                  'Actual GPS Distance',
                  '${((ride?.actualDistanceMeters ?? 0) / 1000.0).toStringAsFixed(1)} km',
                ),
                const SizedBox(height: 6),
                _buildBreakdownRow(
                  'Actual Fuel Cost (Server Reconciled)',
                  '₹${ride?.actualFuelCost?.toStringAsFixed(2) ?? "0.00"}',
                ),
                const Divider(height: 16),
              ],
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isPremium ? 'Authoritative Final Fare' : 'Total Trip Fare',
                        style: TextStyle(color: Colors.grey[600], fontSize: 12),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '₹${fare.toStringAsFixed(2)}',
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.primaryGreen),
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: isPaid ? Colors.green[50] : Colors.amber[50],
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      isPaid ? 'PAID' : 'PAYMENT DUE',
                      style: TextStyle(
                        color: isPaid ? AppColors.primaryGreen : Colors.amber[900],
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
              if (!isPaid) ...[
                const Divider(height: 20),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Select Payment Method', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _buildPaymentChip('wallet', 'Wallet', Icons.account_balance_wallet),
                    const SizedBox(width: 8),
                    _buildPaymentChip('upi', 'UPI', Icons.qr_code),
                    const SizedBox(width: 8),
                    _buildPaymentChip('cash', 'Cash', Icons.money),
                  ],
                ),
                const SizedBox(height: 14),
                InfurnusButton(
                  text: 'Pay ₹${fare.toStringAsFixed(2)}',
                  isLoading: _isProcessingPayment,
                  onPressed: () async {
                    setState(() => _isProcessingPayment = true);
                    final success = await ref.read(rideProvider.notifier).initiateTripPayment(
                          amount: fare,
                          paymentMethod: _selectedPaymentMethod,
                        );
                    if (mounted) {
                      setState(() => _isProcessingPayment = false);
                      if (success) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Payment processed successfully!')),
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
          const Text('Rate your driver & service', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          const SizedBox(height: 8),
          Center(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(5, (index) {
                final starIndex = index + 1;
                return IconButton(
                  icon: Icon(
                    starIndex <= _selectedRating ? Icons.star : Icons.star_border,
                    color: Colors.amber,
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
            decoration: InputDecoration(
              hintText: 'Share feedback (e.g. Prompt service, professional handling)',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            ),
          ),
          const SizedBox(height: 16),
          InfurnusButton(
            text: 'Submit Rating & Feedback',
            onPressed: () async {
              await ref.read(rideProvider.notifier).rateAndReviewRide(_selectedRating, _reviewController.text);
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
              color: Colors.green[50],
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(
              child: Text(
                '★ Rating & feedback submitted. Thank you for choosing INFURNUS!',
                style: TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.bold, fontSize: 13),
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
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedPaymentMethod = id),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primaryDark : Colors.grey[100],
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: isSelected ? Colors.white : Colors.black87),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: isSelected ? Colors.white : Colors.black87,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // --- Step 7: Ride Cancelled ---
  Widget _buildRideCancelledPanel(RideState state) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.cancel_outlined, size: 48, color: Colors.red),
        const SizedBox(height: 12),
        const Text('Ride Cancelled', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 6),
        Text(
          state.currentRide?.cancellationReason ?? 'The ride was cancelled.',
          style: TextStyle(color: Colors.grey[600], fontSize: 13),
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
        color: Colors.red[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red[200]!),
      ),
      child: Text(message, style: const TextStyle(color: Colors.red, fontSize: 13)),
    );
  }
}
