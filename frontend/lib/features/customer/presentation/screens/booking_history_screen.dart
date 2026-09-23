import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../shared/widgets/infurnus_empty_state.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../providers/ride_provider.dart';
import '../../data/models/ride_model.dart' as model;

class BookingHistoryScreen extends ConsumerStatefulWidget {
  const BookingHistoryScreen({super.key});

  @override
  ConsumerState<BookingHistoryScreen> createState() =>
      _BookingHistoryScreenState();
}

class _BookingHistoryScreenState extends ConsumerState<BookingHistoryScreen> {
  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color borderCard = Color(0xFF262626);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color brandGreen = Color(0xFF22C55E);
  static const Color serviceRed = Color(0xFFEF4444);

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
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Text(
          'Booking History',
          style: TextStyle(color: textWhite, fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF050505),
        foregroundColor: textWhite,
        elevation: 0,
      ),
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
      return InfurnusEmptyState(
        icon: Icons.receipt_long_rounded,
        title: 'No bookings yet',
        description: 'Your completed rides, logistics orders, and service requests will appear here.',
        actionLabel: 'Book a Ride',
        onAction: () => context.push('/ride-booking'),
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(rideProvider.notifier).fetchRideHistory(),
      color: brandGreen,
      backgroundColor: cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: state.history.length,
        itemBuilder: (context, index) {
          final ride = state.history[index];
          final isCancelled = ride.status == model.RideStatus.cancelled;

          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Container(
              decoration: BoxDecoration(
                color: cardBg,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: borderCard),
              ),
              child: Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(18),
                child: InkWell(
                  borderRadius: BorderRadius.circular(18),
                  onTap: () {
                    ref.read(rideProvider.notifier).getRideDetails(ride.id);
                    context.push('/ride-booking');
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: isCancelled
                                ? serviceRed.withValues(alpha: 0.15)
                                : brandGreen.withValues(alpha: 0.15),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            ride.sector == 'logistics'
                                ? Icons.local_shipping_rounded
                                : (ride.sector == 'service'
                                      ? Icons.emergency_rounded
                                      : (ride.sector == 'premium'
                                            ? Icons.stars_rounded
                                            : Icons.directions_car_rounded)),
                            color: isCancelled ? serviceRed : brandGreen,
                            size: 22,
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
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                  color: textWhite,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '${ride.sector?.toUpperCase() ?? "PASSENGER"} • ${DateFormat('dd MMM yyyy, hh:mm a').format(ride.createdAt)}',
                                style: const TextStyle(
                                  color: textGray,
                                  fontSize: 12,
                                ),
                              ),
                              if (ride.sector == 'premium' &&
                                  ride.status == model.RideStatus.completed &&
                                  ride.actualDistanceMeters != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  'Actual: ${((ride.actualDistanceMeters ?? 0) / 1000.0).toStringAsFixed(1)} km • ₹${ride.actualFuelCost?.toStringAsFixed(0) ?? "0"} fuel',
                                  style: const TextStyle(
                                    color: Color(0xFFFACC15),
                                    fontSize: 11,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            if (!isCancelled && ride.displayFare > 0)
                              Text(
                                '₹${ride.displayFare.toStringAsFixed(0)}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 16,
                                  color: textWhite,
                                ),
                              ),
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: _getStatusColor(ride.status)
                                    .withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                _formatStatus(ride.status),
                                style: TextStyle(
                                  color: _getStatusColor(ride.status),
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  String _formatStatus(model.RideStatus status) {
    switch (status) {
      case model.RideStatus.requested:
        return 'Requested';
      case model.RideStatus.searching:
        return 'Searching';
      case model.RideStatus.driverAssigned:
        return 'Assigned';
      case model.RideStatus.driverArriving:
        return 'Arriving';
      case model.RideStatus.driverArrived:
        return 'Arrived';
      case model.RideStatus.inProgress:
        return 'In Progress';
      case model.RideStatus.completed:
        return 'Completed';
      case model.RideStatus.cancelled:
        return 'Cancelled';
    }
  }

  Color _getStatusColor(model.RideStatus status) {
    switch (status) {
      case model.RideStatus.completed:
        return brandGreen;
      case model.RideStatus.cancelled:
        return serviceRed;
      case model.RideStatus.requested:
      case model.RideStatus.searching:
        return const Color(0xFFF59E0B);
      default:
        return const Color(0xFF3B82F6);
    }
  }
}
