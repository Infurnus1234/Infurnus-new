import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_brand_mark.dart';
import '../../../../shared/widgets/infurnus_empty_state.dart';
import '../../../../shared/widgets/infurnus_skeleton.dart';
import '../../data/models/ride_model.dart' as model;
import '../providers/ride_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';

class CustomerHomeScreen extends ConsumerStatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  ConsumerState<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends ConsumerState<CustomerHomeScreen> {
  bool _isLoadingHistory = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(rideProvider.notifier).fetchRideHistory();
      if (mounted) {
        setState(() => _isLoadingHistory = false);
      }
    });
  }

  String _getGreeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(userProvider);
    final rideState = ref.watch(rideProvider);
    final currentRide = rideState.currentRide;
    final hasActiveTrip = currentRide != null &&
        currentRide.status != model.RideStatus.completed &&
        currentRide.status != model.RideStatus.cancelled;

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.primaryGreen,
          onRefresh: () async {
            setState(() => _isLoadingHistory = true);
            await ref.read(rideProvider.notifier).fetchRideHistory();
            if (mounted) {
              setState(() => _isLoadingHistory = false);
            }
          },
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top Brand & Quick Actions Header
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const InfurnusBrandMark(
                      iconSize: 32,
                      fontSize: 18,
                      spacing: 8,
                    ),
                    Row(
                      children: [
                        IconButton(
                          icon: const Icon(Icons.chat_bubble_outline_rounded, size: 22),
                          tooltip: 'AI Assistant',
                          onPressed: () => context.push('/ai-assistant/customer'),
                        ),
                        IconButton(
                          icon: const Icon(Icons.account_balance_wallet_outlined, size: 22),
                          tooltip: 'Wallet',
                          onPressed: () => context.push('/wallet'),
                        ),
                        IconButton(
                          icon: const Icon(Icons.person_outline_rounded, size: 24),
                          tooltip: 'Profile',
                          onPressed: () => context.push('/profile'),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 18),

                // Greeting and Role Toggle
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _getGreeting(),
                            style: TextStyle(
                              color: Colors.grey[600],
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${user?.firstName ?? "User"} 👋',
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              color: AppColors.textPrimary,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    // Role Toggle
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.grey[100],
                        borderRadius: BorderRadius.circular(20),
                      ),
                      padding: const EdgeInsets.all(4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _buildToggleOption('Rider', true),
                          _buildToggleOption('Driver', false, onTap: () {
                            if (user?.isApprovedDriver ?? false) {
                              ref.read(userProvider.notifier).switchRole();
                              context.push('/driver-dashboard');
                            } else {
                              context.push('/driver-onboarding');
                            }
                          }),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                // Active Trip Banner (if any)
                if (hasActiveTrip) ...[
                  GestureDetector(
                    onTap: () => context.push('/ride-booking'),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.primaryDark,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primaryGreen.withValues(alpha: 0.25),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.primaryGreen.withValues(alpha: 0.2),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.navigation_rounded,
                                color: AppColors.primaryGreen, size: 24),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: AppColors.primaryGreen,
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: const Text(
                                        'ACTIVE TRIP',
                                        style: TextStyle(
                                          color: Colors.white,
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      _formatStatus(currentRide.status),
                                      style: const TextStyle(
                                          color: Colors.white70, fontSize: 12),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  currentRide.destinationAddress ?? 'Heading to Destination',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.arrow_forward_ios_rounded,
                              color: AppColors.primaryGreen, size: 16),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                ],

                // Hero & Destination Search Bar
                const Text(
                  'Where do you want to go?',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Choose a service below',
                  style: TextStyle(fontSize: 13, color: Colors.grey[600]),
                ),
                const SizedBox(height: 14),
                GestureDetector(
                  onTap: () {
                    ref
                        .read(rideProvider.notifier)
                        .setRoute('Current Location', 'Airport Terminal 1');
                    context.push('/ride-booking');
                  },
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: Colors.grey[50],
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Colors.grey[200]!),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.search_rounded, color: Colors.black54),
                        SizedBox(width: 12),
                        Text(
                          'Search destination',
                          style: TextStyle(color: Colors.black54, fontSize: 15),
                        ),
                        Spacer(),
                        Icon(Icons.tune_rounded, color: Colors.black54, size: 20),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),

                // Mobility Sectors (Four Canonical Sectors in 2x2 Grid)
                Row(
                  children: [
                    Expanded(
                      child: _InteractiveSectorCard(
                        title: 'Passenger',
                        subtitle: 'Ride anywhere',
                        icon: Icons.directions_car_rounded,
                        bgColor: Colors.green[50]!,
                        iconColor: AppColors.primaryGreen,
                        onTap: () {
                          ref.read(rideProvider.notifier).selectSector('passenger');
                          context.push('/ride-booking');
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _InteractiveSectorCard(
                        title: 'Logistics',
                        subtitle: 'Move your goods',
                        icon: Icons.local_shipping_rounded,
                        bgColor: Colors.orange[50]!,
                        iconColor: Colors.orange[800]!,
                        onTap: () {
                          context.push('/logistics');
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _InteractiveSectorCard(
                        title: 'Service Vehicle',
                        subtitle: 'Help when you need it',
                        icon: Icons.emergency_rounded,
                        bgColor: Colors.red[50]!,
                        iconColor: Colors.red[700]!,
                        onTap: () {
                          ref.read(rideProvider.notifier).selectSector('service');
                          context.push('/ride-booking');
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _InteractiveSectorCard(
                        title: 'Premium Vehicle',
                        subtitle: 'Travel in comfort',
                        icon: Icons.stars_rounded,
                        bgColor: Colors.amber[50]!,
                        iconColor: Colors.amber[900]!,
                        onTap: () {
                          context.push('/rentals');
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 32),

                // Recent Activity Section
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Recent Activity',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    if (rideState.history.isNotEmpty)
                      TextButton(
                        onPressed: () => context.push('/booking-history'),
                        child: const Text(
                          'View All',
                          style: TextStyle(
                            color: AppColors.primaryGreen,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),

                // History Content / Loading / Empty States
                if (_isLoadingHistory && rideState.history.isEmpty) ...[
                  const InfurnusSkeletonCard(),
                  const InfurnusSkeletonCard(),
                ] else if (rideState.history.isNotEmpty)
                  ...rideState.history.take(3).map((ride) => _buildActivityItem(ride))
                else
                  InfurnusEmptyState(
                    icon: Icons.route_outlined,
                    title: 'No trips yet',
                    description:
                        'Your completed rides and deliveries will appear here.',
                    actionLabel: 'Book a Ride',
                    onAction: () {
                      ref.read(rideProvider.notifier).selectSector('passenger');
                      context.push('/ride-booking');
                    },
                  ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(
        selectedItemColor: Colors.black,
        unselectedItemColor: Colors.grey[500],
        currentIndex: 0,
        type: BottomNavigationBarType.fixed,
        backgroundColor: Colors.white,
        elevation: 8,
        showSelectedLabels: true,
        showUnselectedLabels: true,
        selectedFontSize: 12,
        unselectedFontSize: 12,
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold),
        onTap: (index) {
          if (index == 1) context.push('/booking-history');
          if (index == 2) context.push('/wallet');
          if (index == 3) context.push('/profile');
        },
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.home_filled),
            label: 'Home',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.local_activity_outlined),
            activeIcon: Icon(Icons.local_activity_rounded),
            label: 'Activity',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.account_balance_wallet_outlined),
            activeIcon: Icon(Icons.account_balance_wallet_rounded),
            label: 'Wallet',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person_outline_rounded),
            activeIcon: Icon(Icons.person_rounded),
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  Widget _buildActivityItem(model.RideModel ride) {
    final formattedDate = DateFormat('MMM d, h:mm a').format(ride.createdAt);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey[100]!),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            ref.read(rideProvider.notifier).getRideDetails(ride.id);
            context.push('/ride-booking');
          },
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.primaryGreen.withValues(alpha: 0.1),
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
                    color: AppColors.primaryGreen,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        ride.destinationAddress ?? 'Ride destination',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${ride.sector?.toUpperCase() ?? "RIDE"} • ${_formatStatus(ride.status)} • $formattedDate',
                        style: TextStyle(color: Colors.grey[600], fontSize: 12),
                      ),
                    ],
                  ),
                ),
                if (ride.status != model.RideStatus.cancelled && ride.displayFare > 0) ...[
                  const SizedBox(width: 8),
                  Text(
                    '₹${ride.displayFare.toStringAsFixed(0)}',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
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
        return 'Driver Assigned';
      case model.RideStatus.driverArriving:
        return 'Driver Arriving';
      case model.RideStatus.driverArrived:
        return 'Driver Arrived';
      case model.RideStatus.inProgress:
        return 'In Progress';
      case model.RideStatus.completed:
        return 'Completed';
      case model.RideStatus.cancelled:
        return 'Cancelled';
    }
  }

  Widget _buildToggleOption(String label, bool isActive, {VoidCallback? onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? Colors.black : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isActive ? Colors.white : Colors.black54,
            fontWeight: FontWeight.bold,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

class _InteractiveSectorCard extends StatefulWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color bgColor;
  final Color iconColor;
  final VoidCallback onTap;

  const _InteractiveSectorCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.bgColor,
    required this.iconColor,
    required this.onTap,
  });

  @override
  State<_InteractiveSectorCard> createState() => _InteractiveSectorCardState();
}

class _InteractiveSectorCardState extends State<_InteractiveSectorCard> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    return AnimatedScale(
      scale: _isPressed ? 0.96 : 1.0,
      duration: const Duration(milliseconds: 100),
      curve: Curves.easeInOut,
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: widget.onTap,
          onTapDown: (_) => setState(() => _isPressed = true),
          onTapUp: (_) => setState(() => _isPressed = false),
          onTapCancel: () => setState(() => _isPressed = false),
          borderRadius: BorderRadius.circular(16),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.grey[200]!),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: widget.bgColor,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(widget.icon, color: widget.iconColor, size: 24),
                ),
                const SizedBox(height: 14),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.title,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      widget.subtitle,
                      style: TextStyle(
                        color: Colors.grey[600],
                        fontSize: 12,
                        fontWeight: FontWeight.w400,
                      ),
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
}
