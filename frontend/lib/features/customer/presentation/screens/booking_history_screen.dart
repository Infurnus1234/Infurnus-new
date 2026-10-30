import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../shared/widgets/infurnus_button.dart';
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
  static const Color mainBg = Color(0xFFF8FAFC);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE2E8F0);
  static const Color textBlack = Color(0xFF0F172A);
  static const Color textGray = Color(0xFF64748B);
  static const Color brandGreen = Color(0xFF10B981);
  static const Color darkGreen = Color(0xFF065F46);
  static const Color serviceRed = Color(0xFFEF4444);
  static const Color blueStatus = Color(0xFF3B82F6);

  String _filter = 'all'; // 'all', 'completed', 'cancelled'

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
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Booking History',
              style: TextStyle(
                color: textBlack,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
            Text(
              'Past rides, deliveries & services',
              style: TextStyle(
                color: textGray,
                fontSize: 12,
                fontWeight: FontWeight.normal,
              ),
            ),
          ],
        ),
        backgroundColor: cardBg,
        foregroundColor: textBlack,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: textBlack),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: textBlack),
            tooltip: 'Refresh',
            onPressed: () => ref.read(rideProvider.notifier).fetchRideHistory(),
          ),
        ],
      ),
      body: _buildContent(rideState),
    );
  }

  Widget _buildContent(RideState state) {
    // 1. Loading State
    if (state.isHistoryLoading && state.history.isEmpty) {
      return _buildLoadingSkeleton();
    }

    // 2. Unauthenticated State (Prompt clean login)
    if (state.isUnauthenticated) {
      return _buildUnauthenticatedView();
    }

    // 3. Error State
    if (state.errorMessage != null && state.history.isEmpty) {
      return InfurnusErrorView(
        message: state.errorMessage!,
        onRetry: () => ref.read(rideProvider.notifier).fetchRideHistory(),
      );
    }

    // 4. Empty State
    if (state.history.isEmpty) {
      return _buildEmptyState();
    }

    // 5. Loaded List with Filters
    final filtered = state.history.where((ride) {
      if (_filter == 'completed') {
        return ride.status == model.RideStatus.completed;
      }
      if (_filter == 'cancelled') {
        return ride.status == model.RideStatus.cancelled;
      }
      return true;
    }).toList();

    return RefreshIndicator(
      onRefresh: () => ref.read(rideProvider.notifier).fetchRideHistory(),
      color: brandGreen,
      backgroundColor: cardBg,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          _buildFilterTabs(),
          const SizedBox(height: 12),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 48),
              child: Center(
                child: Text(
                  'No $_filter bookings found',
                  style: const TextStyle(color: textGray, fontSize: 14),
                ),
              ),
            )
          else
            ...filtered.map((ride) => _buildRideCard(ride)),
        ],
      ),
    );
  }

  Widget _buildFilterTabs() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildFilterChip('All Bookings', 'all'),
          const SizedBox(width: 8),
          _buildFilterChip('Completed', 'completed'),
          const SizedBox(width: 8),
          _buildFilterChip('Cancelled', 'cancelled'),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _filter == value;
    return GestureDetector(
      onTap: () => setState(() => _filter = value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? darkGreen : cardBg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: isSelected ? darkGreen : borderCard),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: brandGreen.withValues(alpha: 0.2),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
            color: isSelected ? Colors.white : textBlack,
          ),
        ),
      ),
    );
  }

  Widget _buildRideCard(model.RideModel ride) {
    final isCancelled = ride.status == model.RideStatus.cancelled;
    final dateStr = DateFormat('dd MMM yyyy • hh:mm a').format(ride.createdAt);
    final sectorLabel = (ride.sector ?? 'passenger').toUpperCase();

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCard),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _showRideDetailsModal(context, ride),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top header: Sector badge + Date + Status pill
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: _getSectorBg(ride.sector),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                _getSectorIcon(ride.sector),
                                size: 12,
                                color: _getSectorColor(ride.sector),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                sectorLabel,
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                  color: _getSectorColor(ride.sector),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          dateStr,
                          style: const TextStyle(
                            fontSize: 11,
                            color: textGray,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                    _buildStatusChip(ride.status),
                  ],
                ),
                const SizedBox(height: 14),

                // Middle: Route with vertical path indicator
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Column(
                      children: [
                        const Icon(
                          Icons.radio_button_checked_rounded,
                          color: brandGreen,
                          size: 16,
                        ),
                        Container(
                          width: 2,
                          height: 28,
                          margin: const EdgeInsets.symmetric(vertical: 2),
                          color: borderCard,
                        ),
                        const Icon(
                          Icons.location_on_rounded,
                          color: serviceRed,
                          size: 16,
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            ride.pickupAddress ??
                                'Pickup (${ride.pickup.latitude.toStringAsFixed(3)}, ${ride.pickup.longitude.toStringAsFixed(3)})',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: textBlack,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 18),
                          Text(
                            ride.destinationAddress ??
                                'Drop (${ride.destination.latitude.toStringAsFixed(3)}, ${ride.destination.longitude.toStringAsFixed(3)})',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: textBlack,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),

                const Divider(height: 1, color: borderCard),
                const SizedBox(height: 10),

                // Bottom footer: Driver info / Vehicle & Fare
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 14,
                            backgroundColor: const Color(0xFFF1F5F9),
                            child: Icon(
                              ride.driverDetails != null
                                  ? Icons.person_rounded
                                  : Icons.directions_car_filled_rounded,
                              size: 16,
                              color: textGray,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  ride.driverDetails?.name.isNotEmpty == true
                                      ? ride.driverDetails!.name
                                      : (ride.vehicleCategory?.toUpperCase() ??
                                            'INFURNUS RIDE'),
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: textBlack,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                                if (ride.vehicleDetails != null)
                                  Text(
                                    '${ride.vehicleDetails!.make} • ${ride.vehicleDetails!.plateNumber}',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: textGray,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (!isCancelled && ride.displayFare > 0)
                          Text(
                            '₹${ride.displayFare.toStringAsFixed(2)}',
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                              color: textBlack,
                            ),
                          )
                        else if (isCancelled)
                          const Text(
                            'Cancelled',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: serviceRed,
                            ),
                          ),
                        const SizedBox(height: 2),
                        const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'View Details',
                              style: TextStyle(
                                fontSize: 11,
                                color: brandGreen,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Icon(
                              Icons.chevron_right_rounded,
                              size: 14,
                              color: brandGreen,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStatusChip(model.RideStatus status) {
    Color bg;
    Color fg;
    String label;

    switch (status) {
      case model.RideStatus.completed:
        bg = const Color(0xFFD1FAE5);
        fg = const Color(0xFF065F46);
        label = 'Completed';
        break;
      case model.RideStatus.cancelled:
        bg = const Color(0xFFFEE2E2);
        fg = const Color(0xFF991B1B);
        label = 'Cancelled';
        break;
      case model.RideStatus.inProgress:
        bg = const Color(0xFFFEF3C7);
        fg = const Color(0xFF92400E);
        label = 'In Progress';
        break;
      case model.RideStatus.driverArrived:
      case model.RideStatus.driverArriving:
      case model.RideStatus.driverAssigned:
        bg = const Color(0xFFDBEAFE);
        fg = const Color(0xFF1E40AF);
        label = 'Assigned';
        break;
      default:
        bg = const Color(0xFFF1F5F9);
        fg = const Color(0xFF475569);
        label = 'Searching';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: fg),
      ),
    );
  }

  Widget _buildUnauthenticatedView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28.0),
        child: Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: borderCard),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: brandGreen.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.lock_outline_rounded,
                  size: 36,
                  color: brandGreen,
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Sign In to View Bookings',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: textBlack,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              const Text(
                'Please sign in to your INFURNUS account to review all your past and scheduled rides, logistics shipments, and emergency services.',
                style: TextStyle(fontSize: 13, color: textGray, height: 1.4),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              InfurnusButton(
                text: 'Sign In to Account',
                onPressed: () => context.push('/login'),
                isFullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                shape: BoxShape.circle,
                border: Border.all(color: borderCard),
              ),
              child: const Icon(
                Icons.receipt_long_rounded,
                size: 40,
                color: textGray,
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'No Bookings Yet',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: textBlack,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Your completed rides, logistics orders, and service requests will appear here once you take your first trip.',
              style: TextStyle(color: textGray, fontSize: 13, height: 1.4),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: 200,
              child: InfurnusButton(
                text: 'Book a Ride Now',
                onPressed: () => context.push('/ride-booking'),
                isFullWidth: true,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoadingSkeleton() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: 4,
      itemBuilder: (context, index) {
        return Container(
          margin: const EdgeInsets.only(bottom: 14),
          height: 140,
          decoration: BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: borderCard),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      width: 90,
                      height: 18,
                      decoration: BoxDecoration(
                        color: const Color(0xFFE2E8F0),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    Container(
                      width: 70,
                      height: 18,
                      decoration: BoxDecoration(
                        color: const Color(0xFFE2E8F0),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                Container(
                  width: double.infinity,
                  height: 14,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  width: 220,
                  height: 14,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showRideDetailsModal(BuildContext context, model.RideModel ride) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(20),
          decoration: const BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFCBD5E1),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Ride Details',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: textBlack,
                          ),
                        ),
                        Text(
                          'ID: ${ride.id.substring(0, 8).toUpperCase()}',
                          style: const TextStyle(fontSize: 12, color: textGray),
                        ),
                      ],
                    ),
                    _buildStatusChip(ride.status),
                  ],
                ),
                const SizedBox(height: 16),
                const Divider(color: borderCard),
                const SizedBox(height: 12),

                // Pickup & Drop
                const Text(
                  'Route & Locations',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: textBlack,
                  ),
                ),
                const SizedBox(height: 10),
                _buildModalDetailRow(
                  Icons.radio_button_checked,
                  'Pickup Point',
                  ride.pickupAddress ??
                      '(${ride.pickup.latitude.toStringAsFixed(4)}, ${ride.pickup.longitude.toStringAsFixed(4)})',
                  brandGreen,
                ),
                const SizedBox(height: 10),
                _buildModalDetailRow(
                  Icons.location_on,
                  'Destination',
                  ride.destinationAddress ??
                      '(${ride.destination.latitude.toStringAsFixed(4)}, ${ride.destination.longitude.toStringAsFixed(4)})',
                  serviceRed,
                ),
                const SizedBox(height: 16),
                const Divider(color: borderCard),
                const SizedBox(height: 12),

                // Driver & Vehicle
                if (ride.driverDetails != null ||
                    ride.vehicleDetails != null) ...[
                  const Text(
                    'Assigned Driver & Fleet',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: textBlack,
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (ride.driverDetails != null)
                    _buildModalDetailRow(
                      Icons.person,
                      'Driver Name',
                      ride.driverDetails!.name,
                      blueStatus,
                    ),
                  if (ride.vehicleDetails != null) ...[
                    const SizedBox(height: 10),
                    _buildModalDetailRow(
                      Icons.directions_car,
                      'Vehicle Plate',
                      '${ride.vehicleDetails!.make} ${ride.vehicleDetails!.model} • ${ride.vehicleDetails!.plateNumber}',
                      textBlack,
                    ),
                  ],
                  const SizedBox(height: 16),
                  const Divider(color: borderCard),
                  const SizedBox(height: 12),
                ],

                // Fare Breakdown
                const Text(
                  'Payment Summary',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: textBlack,
                  ),
                ),
                const SizedBox(height: 10),
                () {
                  final bool isCancelled =
                      ride.status == model.RideStatus.cancelled;
                  final bool isCompleted =
                      ride.status == model.RideStatus.completed;
                  final bool isCaptured =
                      ride.paymentStatus?.toLowerCase() == 'captured' ||
                      ride.paymentStatus?.toLowerCase() == 'settled';

                  final String fareLabel = isCancelled
                      ? 'Estimated Fare (Cancelled)'
                      : isCompleted && isCaptured
                      ? 'Total Fare Settled'
                      : isCompleted && !isCaptured
                      ? 'Payment Due'
                      : 'Estimated Fare';

                  return Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(fareLabel, style: const TextStyle(color: textGray)),
                      Text(
                        '₹${ride.displayFare.toStringAsFixed(2)}',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color: isCancelled ? textGray : textBlack,
                          decoration: isCancelled
                              ? TextDecoration.lineThrough
                              : null,
                        ),
                      ),
                    ],
                  );
                }(),
                if (ride.actualDistanceMeters != null) ...[
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total Distance',
                        style: TextStyle(color: textGray),
                      ),
                      Text(
                        '${((ride.actualDistanceMeters ?? 0) / 1000.0).toStringAsFixed(2)} km',
                        style: const TextStyle(color: textBlack),
                      ),
                    ],
                  ),
                ],
                if (ride.cancellationReason != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Cancellation Reason: ${ride.cancellationReason}',
                      style: const TextStyle(color: serviceRed, fontSize: 12),
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                InfurnusButton(
                  text: 'Close',
                  onPressed: () => Navigator.pop(context),
                  isFullWidth: true,
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildModalDetailRow(
    IconData icon,
    String label,
    String value,
    Color iconColor,
  ) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: iconColor),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(color: textGray, fontSize: 11),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  color: textBlack,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  IconData _getSectorIcon(String? sector) {
    switch (sector) {
      case 'logistics':
        return Icons.local_shipping_rounded;
      case 'service':
        return Icons.emergency_rounded;
      case 'premium':
        return Icons.stars_rounded;
      default:
        return Icons.directions_car_rounded;
    }
  }

  Color _getSectorColor(String? sector) {
    switch (sector) {
      case 'logistics':
        return const Color(0xFF7C3AED);
      case 'service':
        return const Color(0xFFDC2626);
      case 'premium':
        return const Color(0xFFD97706);
      default:
        return const Color(0xFF2563EB);
    }
  }

  Color _getSectorBg(String? sector) {
    switch (sector) {
      case 'logistics':
        return const Color(0xFFEDE9FE);
      case 'service':
        return const Color(0xFFFEE2E2);
      case 'premium':
        return const Color(0xFFFEF3C7);
      default:
        return const Color(0xFFDBEAFE);
    }
  }
}
