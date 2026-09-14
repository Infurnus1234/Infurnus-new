import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../providers/ride_provider.dart';

class RideBookingScreen extends ConsumerWidget {
  const RideBookingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rideState = ref.watch(rideProvider);

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
          // Mock Map Area
          Container(
            color: Colors.grey[200],
            child: const Center(
              child: Icon(Icons.map, size: 100, color: Colors.grey),
            ),
          ),
          
          // Bottom Sheet UI
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
                  if (rideState.status == RideStatus.initial) ...[
                    _buildRouteInfo(rideState),
                    const SizedBox(height: 24),
                    InfurnusButton(
                      text: 'Confirm Booking - ₹${rideState.fare}',
                      onPressed: () => ref.read(rideProvider.notifier).requestRide(),
                    ),
                  ] else if (rideState.status == RideStatus.searching) ...[
                    const CircularProgressIndicator(color: AppColors.primaryGreen),
                    const SizedBox(height: 16),
                    const Text('Finding your driver...', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 24),
                    TextButton(
                      onPressed: () => ref.read(rideProvider.notifier).cancelRide(),
                      child: const Text('Cancel', style: TextStyle(color: Colors.red)),
                    ),
                  ] else if (rideState.status == RideStatus.matched) ...[
                    const Text('Driver Matched!', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.primaryGreen)),
                    const SizedBox(height: 16),
                    _buildDriverInfo(rideState),
                    const SizedBox(height: 24),
                    InfurnusButton(
                      text: 'Track Ride',
                      onPressed: () {},
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

  Widget _buildRouteInfo(RideState state) {
    return Column(
      children: [
        _locationRow(Icons.my_location, state.pickup ?? 'Select Pickup', AppColors.primaryGreen),
        const Padding(
          padding: EdgeInsets.only(left: 12),
          child: Align(alignment: Alignment.centerLeft, child: SizedBox(height: 20, child: VerticalDivider())),
        ),
        _locationRow(Icons.location_on, state.destination ?? 'Select Destination', Colors.red),
      ],
    );
  }

  Widget _locationRow(IconData icon, String text, Color color) {
    return Row(
      children: [
        Icon(icon, color: color, size: 24),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _buildDriverInfo(RideState state) {
    return Row(
      children: [
        const CircleAvatar(radius: 30, backgroundColor: Colors.grey, child: Icon(Icons.person, color: Colors.white)),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(state.driverName ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              Text(state.vehicleInfo ?? '', style: const TextStyle(color: Colors.grey)),
            ],
          ),
        ),
        const Icon(Icons.call, color: AppColors.primaryGreen),
      ],
    );
  }
}
