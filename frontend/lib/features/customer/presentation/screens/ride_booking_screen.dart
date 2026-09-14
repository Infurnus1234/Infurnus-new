import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_map.dart';
import '../providers/ride_provider.dart';

class RideBookingScreen extends ConsumerStatefulWidget {
  const RideBookingScreen({super.key});

  @override
  ConsumerState<RideBookingScreen> createState() => _RideBookingScreenState();
}

class _RideBookingScreenState extends ConsumerState<RideBookingScreen> {
  final _pickupController = TextEditingController();
  final _destinationController = TextEditingController();

  @override
  void initState() {
    super.initState();
    final rideState = ref.read(rideProvider);
    _pickupController.text = rideState.pickup ?? '';
    _destinationController.text = rideState.destination ?? '';
  }

  @override
  void dispose() {
    _pickupController.dispose();
    _destinationController.dispose();
    super.dispose();
  }

  void _handleBooking() {
    if (_pickupController.text.isEmpty || _destinationController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter pickup and destination')),
      );
      return;
    }

    ref.read(rideProvider.notifier).setRoute(
          _pickupController.text,
          _destinationController.text,
        );
    ref.read(rideProvider.notifier).requestRide();
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);

    final pickupLatLng = rideState.currentRide != null
        ? LatLng(rideState.currentRide!.pickup.latitude,
            rideState.currentRide!.pickup.longitude)
        : null;
    final destinationLatLng = rideState.currentRide != null
        ? LatLng(rideState.currentRide!.destination.latitude,
            rideState.currentRide!.destination.longitude)
        : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Book a Ride'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: Stack(
        children: [
          InfurnusMap(
            pickup: pickupLatLng,
            destination: destinationLatLng,
            driverLocation: rideState.lastDriverLocation,
            route: rideState.currentRoute,
          ),

          // Bottom UI
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 10)],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (rideState.errorMessage != null)
                    _buildErrorView(rideState.errorMessage!),
                  
                  if (rideState.status == RideStatus.initial || rideState.status == RideStatus.error) ...[
                    _buildRouteInputs(),
                    const SizedBox(height: 24),
                    InfurnusButton(
                      text: rideState.fare != null 
                        ? 'Confirm Booking - ₹${rideState.fare}' 
                        : 'Confirm Booking',
                      isLoading: rideState.status == RideStatus.searching,
                      onPressed: _handleBooking,
                    ),
                  ] else if (rideState.status == RideStatus.searching) ...[
                    const CircularProgressIndicator(color: AppColors.primaryGreen),
                    const SizedBox(height: 16),
                    const Text('Finding your driver...', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 24),
                    TextButton(
                      onPressed: () => ref.read(rideProvider.notifier).cancelRide(),
                      child: const Text('Cancel Request', style: TextStyle(color: Colors.red)),
                    ),
                  ] else if (rideState.status == RideStatus.matched || rideState.status == RideStatus.active) ...[
                    Text(
                      rideState.status == RideStatus.matched ? 'Driver Matched!' : 'Ride in Progress',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.primaryGreen),
                    ),
                    const SizedBox(height: 16),
                    _buildDriverDetails(rideState),
                    const SizedBox(height: 24),
                    InfurnusButton(
                      text: 'Back to Home',
                      onPressed: () => context.go('/customer-home'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteInputs() {
    return Column(
      children: [
        TextField(
          controller: _pickupController,
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.my_location, color: AppColors.primaryGreen),
            hintText: 'Pickup Location',
            border: InputBorder.none,
          ),
        ),
        const Divider(),
        TextField(
          controller: _destinationController,
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.location_on, color: Colors.red),
            hintText: 'Destination',
            border: InputBorder.none,
          ),
        ),
      ],
    );
  }

  Widget _buildDriverDetails(RideState state) {
    return Row(
      children: [
        const CircleAvatar(radius: 30, backgroundColor: Colors.grey, child: Icon(Icons.person, color: Colors.white)),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(state.currentRide?.assignedDriverId ?? 'Driver Assigned', 
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              Text('Vehicle: ${state.currentRide?.assignedVehicleId ?? "Standard Sedan"}', 
                style: const TextStyle(color: Colors.grey)),
            ],
          ),
        ),
        IconButton(
          icon: const Icon(Icons.call, color: AppColors.primaryGreen),
          onPressed: () {},
        ),
      ],
    );
  }

  Widget _buildErrorView(String message) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Text(
        message,
        style: const TextStyle(color: Colors.red, fontSize: 14),
        textAlign: TextAlign.center,
      ),
    );
  }
}
