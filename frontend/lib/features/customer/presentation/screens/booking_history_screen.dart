import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../providers/ride_provider.dart';
import '../../data/models/ride_model.dart' as model;

class BookingHistoryScreen extends ConsumerStatefulWidget {
  const BookingHistoryScreen({super.key});

  @override
  ConsumerState<BookingHistoryScreen> createState() => _BookingHistoryScreenState();
}

class _BookingHistoryScreenState extends ConsumerState<BookingHistoryScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(rideProvider.notifier).fetchRideHistory();
    });
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Booking History')),
      body: _buildBody(rideState),
    );
  }

  Widget _buildBody(RideState state) {
    if (state.history.isEmpty) {
      if (state.errorMessage != null) {
        return InfurnusErrorView(
          message: state.errorMessage!,
          onRetry: () => ref.read(rideProvider.notifier).fetchRideHistory(),
        );
      }
      return const Center(child: Text('No bookings found'));
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(rideProvider.notifier).fetchRideHistory(),
      color: AppColors.primaryGreen,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: state.history.length,
        itemBuilder: (context, index) {
          final ride = state.history[index];
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: InfurnusCard(
              onTap: () {
                ref.read(rideProvider.notifier).getRideDetails(ride.id);
                context.push('/ride-booking');
              },
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.primaryGreen.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      ride.sector == 'logistics'
                          ? Icons.local_shipping
                          : (ride.sector == 'service'
                              ? Icons.emergency
                              : (ride.sector == 'premium' ? Icons.stars : Icons.directions_car)),
                      color: AppColors.primaryGreen,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          ride.destinationAddress ??
                              'Ride to ${ride.destination.latitude.toStringAsFixed(3)}, ${ride.destination.longitude.toStringAsFixed(3)}',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${ride.sector?.toUpperCase() ?? "PASSENGER"} • ${DateFormat('dd MMM yyyy, hh:mm a').format(ride.createdAt)}',
                          style: TextStyle(color: Colors.grey[600], fontSize: 12),
                        ),
                        if (ride.sector == 'premium' && ride.status == model.RideStatus.completed && ride.actualDistanceMeters != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            'Actual: ${((ride.actualDistanceMeters ?? 0) / 1000.0).toStringAsFixed(1)} km • ₹${ride.actualFuelCost?.toStringAsFixed(0) ?? "0"} fuel',
                            style: TextStyle(color: Colors.amber[900], fontSize: 11, fontWeight: FontWeight.w500),
                          ),
                        ],
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (ride.status != model.RideStatus.cancelled && ride.displayFare > 0)
                        Text(
                          '₹${ride.displayFare.toStringAsFixed(0)}',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                      const SizedBox(height: 4),
                      Text(
                        _formatStatus(ride.status),
                        style: TextStyle(
                          color: _getStatusColor(ride.status),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  String _formatStatus(model.RideStatus status) {
    switch (status) {
      case model.RideStatus.requested: return 'Requested';
      case model.RideStatus.searching: return 'Searching';
      case model.RideStatus.driverAssigned: return 'Driver Assigned';
      case model.RideStatus.driverArriving: return 'Arriving';
      case model.RideStatus.driverArrived: return 'Arrived';
      case model.RideStatus.inProgress: return 'In Progress';
      case model.RideStatus.completed: return 'Completed';
      case model.RideStatus.cancelled: return 'Cancelled';
    }
  }

  Color _getStatusColor(model.RideStatus status) {
    switch (status) {
      case model.RideStatus.completed: return AppColors.primaryGreen;
      case model.RideStatus.cancelled: return Colors.red;
      case model.RideStatus.requested:
      case model.RideStatus.searching: return Colors.orange;
      default: return AppColors.primaryDark;
    }
  }
}
