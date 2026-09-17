import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_map.dart';
import '../../../../shared/widgets/infurnus_outlined_button.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../../../customer/data/models/ride_model.dart';
import '../providers/driver_dashboard_provider.dart';
import '../providers/driver_ride_provider.dart';

class DriverRideRequestScreen extends ConsumerStatefulWidget {
  final String? initialRideId;

  const DriverRideRequestScreen({super.key, this.initialRideId});

  @override
  ConsumerState<DriverRideRequestScreen> createState() => _DriverRideRequestScreenState();
}

class _DriverRideRequestScreenState extends ConsumerState<DriverRideRequestScreen> {
  final _rideIdController = TextEditingController();
  bool _showManualEntry = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialRideId != null) {
      _rideIdController.text = widget.initialRideId!;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(driverRideProvider.notifier).acceptRide(widget.initialRideId!);
      });
    }
  }

  @override
  void dispose() {
    _rideIdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dashboardState = ref.watch(driverDashboardProvider);
    final driverRideState = ref.watch(driverRideProvider);
    final currentRide = driverRideState.currentRide;

    final partner = dashboardState.partner;
    final bool isApproved = partner?.approvalStatus == 'approved';
    final bool isOnline = partner?.availabilityStatus == 'available';

    final pickupLatLng = currentRide != null
        ? LatLng(currentRide.pickup.latitude, currentRide.pickup.longitude)
        : null;
    final destinationLatLng = currentRide != null
        ? LatLng(currentRide.destination.latitude, currentRide.destination.longitude)
        : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Driver Ride Panel'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh available rides',
            onPressed: () => ref.read(driverRideProvider.notifier).fetchAvailableRides(),
          ),
        ],
      ),
      body: Stack(
        children: [
          // 1. Map View
          InfurnusMap(
            pickup: pickupLatLng,
            destination: destinationLatLng,
            route: driverRideState.currentRoute,
          ),

          // 2. Driver Ride Control Panel
          Align(
            alignment: Alignment.bottomCenter,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: InfurnusCard(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (!isApproved || !isOnline)
                      _buildEligibilityWarning(isApproved, isOnline)
                    else if (driverRideState.errorMessage != null)
                      _buildErrorBanner(driverRideState.errorMessage!),

                    if (currentRide == null) ...[
                      _buildIncomingRequestsSection(
                        driverRideState,
                        isApproved,
                        isOnline,
                      ),
                    ] else ...[
                      // Active Ride Information & Lifecycle Actions
                      _buildActiveRideDetails(currentRide),
                      const SizedBox(height: 16),
                      _buildLifecycleActionButtons(
                        context,
                        currentRide,
                        driverRideState,
                        isApproved,
                        isOnline,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEligibilityWarning(bool isApproved, bool isOnline) {
    String message = 'You must be approved and online to accept ride requests.';
    if (!isApproved) {
      message = 'Your partner profile is not approved yet.';
    } else if (!isOnline) {
      message = 'You are currently offline. Please go online on the Dashboard.';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.amber[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.amber[300]!),
      ),
      child: Text(message, style: const TextStyle(color: Colors.black87, fontSize: 13)),
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

  Widget _buildIncomingRequestsSection(
    DriverRideState state,
    bool isApproved,
    bool isOnline,
  ) {
    if (state.isLoadingAvailable && state.availableRides.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(
          child: Column(
            children: [
              CircularProgressIndicator(color: AppColors.primaryGreen),
              SizedBox(height: 12),
              Text('Checking for ride requests...', style: TextStyle(color: Colors.grey, fontSize: 13)),
            ],
          ),
        ),
      );
    }

    if (state.availableRides.isEmpty) {
      return Column(
        children: [
          const SizedBox(height: 8),
          const Icon(Icons.radar, size: 48, color: AppColors.primaryGreen),
          const SizedBox(height: 12),
          const Text(
            'Searching for nearby rides...',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
          ),
          const SizedBox(height: 6),
          const Text(
            'Stay online. Incoming ride requests will appear here automatically in real-time.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey, fontSize: 12),
          ),
          const SizedBox(height: 16),
          InfurnusOutlinedButton(
            text: 'Refresh Feed',
            onPressed: () => ref.read(driverRideProvider.notifier).fetchAvailableRides(),
          ),
          const SizedBox(height: 8),
          _buildManualEntryToggle(isApproved, isOnline, state),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Incoming Requests (${state.availableRides.length})',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.primaryGreen.withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.flash_on, size: 14, color: AppColors.primaryGreen),
                  SizedBox(width: 4),
                  Text('LIVE', style: TextStyle(color: AppColors.primaryGreen, fontSize: 11, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ...state.availableRides.map((ride) => _buildRideCard(ride, isApproved, isOnline, state)),
        _buildManualEntryToggle(isApproved, isOnline, state),
      ],
    );
  }

  Widget _buildRideCard(
    RideModel ride,
    bool isApproved,
    bool isOnline,
    DriverRideState state,
  ) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.grey[200]!),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Ride #${ride.id.substring(0, 8)}',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              ),
              if (ride.fareEstimate != null)
                Text(
                  '₹${ride.fareEstimate!.toStringAsFixed(0)}',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: AppColors.primaryGreen,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          _locationRow(
            Icons.my_location,
            'Pickup',
            ride.pickupAddress ?? '${ride.pickup.latitude.toStringAsFixed(4)}, ${ride.pickup.longitude.toStringAsFixed(4)}',
            AppColors.primaryGreen,
          ),
          const SizedBox(height: 6),
          _locationRow(
            Icons.location_on,
            'Destination',
            ride.destinationAddress ?? '${ride.destination.latitude.toStringAsFixed(4)}, ${ride.destination.longitude.toStringAsFixed(4)}',
            Colors.red,
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: InfurnusOutlinedButton(
                  text: 'Decline',
                  onPressed: () => ref.read(driverRideProvider.notifier).dismissRide(ride.id),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: InfurnusButton(
                  text: 'Accept',
                  isLoading: state.isAccepting,
                  onPressed: (!isApproved || !isOnline)
                      ? null
                      : () => ref.read(driverRideProvider.notifier).acceptRide(ride.id),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildManualEntryToggle(bool isApproved, bool isOnline, DriverRideState state) {
    return Column(
      children: [
        Center(
          child: TextButton(
            onPressed: () {
              setState(() {
                _showManualEntry = !_showManualEntry;
              });
            },
            child: Text(
              _showManualEntry ? 'Hide manual entry' : 'Enter Ride ID manually',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ),
        ),
        if (_showManualEntry) ...[
          const SizedBox(height: 8),
          InfurnusTextField(
            label: 'Ride UUID',
            hintText: 'Enter ride ID',
            controller: _rideIdController,
          ),
          const SizedBox(height: 8),
          InfurnusButton(
            text: 'Accept by ID',
            isLoading: state.isAccepting,
            onPressed: (!isApproved || !isOnline)
                ? null
                : () {
                    final rideId = _rideIdController.text.trim();
                    if (rideId.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Please enter a valid Ride ID')),
                      );
                      return;
                    }
                    ref.read(driverRideProvider.notifier).acceptRide(rideId);
                  },
          ),
        ],
      ],
    );
  }

  Widget _buildActiveRideDetails(RideModel ride) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Ride #${ride.id.substring(0, 8)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.primaryGreen.withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                ride.status.name.toUpperCase(),
                style: const TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.bold, fontSize: 11),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _locationRow(Icons.my_location, 'Pickup', ride.pickupAddress ?? '${ride.pickup.latitude}, ${ride.pickup.longitude}', AppColors.primaryGreen),
        const SizedBox(height: 8),
        _locationRow(Icons.location_on, 'Destination', ride.destinationAddress ?? '${ride.destination.latitude}, ${ride.destination.longitude}', Colors.red),
      ],
    );
  }

  Widget _locationRow(IconData icon, String label, String address, Color color) {
    return Row(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: Colors.grey, fontSize: 11)),
              Text(address, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13), overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildLifecycleActionButtons(
    BuildContext context,
    RideModel ride,
    DriverRideState state,
    bool isApproved,
    bool isOnline,
  ) {
    if (state.isUpdatingStatus) {
      return const Center(child: CircularProgressIndicator(color: AppColors.primaryGreen));
    }

    final notifier = ref.read(driverRideProvider.notifier);

    switch (ride.status) {
      case RideStatus.driverAssigned:
        return InfurnusButton(
          text: 'Arriving at Pickup',
          onPressed: (!isApproved || !isOnline)
              ? null
              : () => notifier.transitionStatus(ride.id, 'driver_arriving'),
        );

      case RideStatus.driverArriving:
        return InfurnusButton(
          text: 'Arrived at Pickup',
          onPressed: (!isApproved || !isOnline)
              ? null
              : () => notifier.transitionStatus(ride.id, 'driver_arrived'),
        );

      case RideStatus.driverArrived:
        return InfurnusButton(
          text: 'Start Ride (In Progress)',
          onPressed: (!isApproved || !isOnline)
              ? null
              : () => notifier.transitionStatus(ride.id, 'in_progress'),
        );

      case RideStatus.inProgress:
        return InfurnusButton(
          text: 'Complete Ride',
          onPressed: (!isApproved || !isOnline)
              ? null
              : () => notifier.completeRide(ride.id),
        );

      case RideStatus.completed:
      case RideStatus.cancelled:
        return Column(
          children: [
            Text(
              ride.status == RideStatus.completed ? 'Ride Completed 🎉' : 'Ride Cancelled',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 12),
            InfurnusOutlinedButton(
              text: 'Return to Dashboard',
              onPressed: () => context.go('/driver-dashboard'),
            ),
          ],
        );

      default:
        return const SizedBox.shrink();
    }
  }
}
