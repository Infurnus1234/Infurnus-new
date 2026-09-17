import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../providers/driver_dashboard_provider.dart';
import '../providers/driver_ride_provider.dart';

class DriverDashboardScreen extends ConsumerStatefulWidget {
  const DriverDashboardScreen({super.key});

  @override
  ConsumerState<DriverDashboardScreen> createState() => _DriverDashboardScreenState();
}

class _DriverDashboardScreenState extends ConsumerState<DriverDashboardScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(driverDashboardProvider.notifier).loadDashboard();
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(userProvider);
    final dashboardState = ref.watch(driverDashboardProvider);
    final driverRideState = ref.watch(driverRideProvider);
    final partner = dashboardState.partner;
    final vehicle = dashboardState.vehicle;

    final bool isApproved = partner?.approvalStatus == 'approved';
    final bool isOnline = partner?.availabilityStatus == 'available';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Driver Dashboard'),
        actions: [
          if (isApproved)
            Padding(
              padding: const EdgeInsets.only(right: 16.0),
              child: Row(
                children: [
                  if (dashboardState.isUpdatingAvailability)
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.primaryGreen,
                      ),
                    )
                  else ...[
                    Text(
                      isOnline ? 'ONLINE' : 'OFFLINE',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: isOnline ? AppColors.primaryGreen : Colors.grey,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Switch(
                      value: isOnline,
                      onChanged: (val) {
                        final newStatus = val ? 'available' : 'unavailable';
                        ref.read(driverDashboardProvider.notifier).updateAvailability(newStatus);
                      },
                      activeTrackColor: AppColors.primaryGreen,
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
      body: _buildBody(
        context,
        user,
        dashboardState,
        driverRideState,
        partner,
        vehicle,
        isApproved,
        isOnline,
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    dynamic user,
    DriverDashboardState state,
    DriverRideState rideState,
    dynamic partner,
    dynamic vehicle,
    bool isApproved,
    bool isOnline,
  ) {
    if (state.isLoading) {
      return const InfurnusLoader(message: 'Loading Driver Dashboard...');
    }

    if (state.errorMessage != null && partner == null) {
      return InfurnusErrorView(
        message: state.errorMessage!,
        onRetry: () => ref.read(driverDashboardProvider.notifier).loadDashboard(),
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(driverDashboardProvider.notifier).loadDashboard(),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Welcome Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Welcome, ${user?.firstName ?? "Driver"}',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      partner != null ? partner.businessName : 'INFURNUS Mobility Driver',
                      style: TextStyle(fontSize: 13, color: Colors.grey[600]),
                    ),
                  ],
                ),
                if (state.isBroadcastingLocation)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.primaryGreen.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.primaryGreen.withOpacity(0.3)),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.gps_fixed, size: 13, color: AppColors.primaryGreen),
                        SizedBox(width: 4),
                        Text(
                          'GPS Live',
                          style: TextStyle(
                            color: AppColors.primaryGreen,
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),

            if (state.errorMessage != null) _buildErrorBanner(state.errorMessage!),

            // ACTIVE BOOKING / RIDE BANNER (If assigned or in progress)
            if (rideState.currentRide != null) ...[
              _buildActiveBookingCard(context, rideState.currentRide!),
              const SizedBox(height: 16),
            ],

            // 1. Partner Status / Onboarding CTA
            if (partner == null)
              _buildNoPartnerCard(context)
            else
              _buildPartnerStatusCard(context, partner),

            const SizedBox(height: 16),

            // 2. Real-Time Earnings & Trips Summary (If approved)
            if (partner != null && isApproved) ...[
              _buildEarningsSummaryCard(context, state),
              const SizedBox(height: 16),
            ],

            // 3. Vehicle Card
            if (partner != null && isApproved) ...[
              _buildVehicleCard(context, vehicle),
              const SizedBox(height: 16),
            ],

            // 4. Quick Action Cards
            const Text(
              'Driver Operations',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),

            _buildActionCard(
              Icons.local_taxi,
              'Ride Panel & Live Requests',
              rideState.availableRides.isNotEmpty
                  ? '${rideState.availableRides.length} incoming requests available!'
                  : 'Accept rides and manage trip lifecycle',
              () => context.push('/driver-ride-request'),
              badge: rideState.availableRides.isNotEmpty
                  ? '${rideState.availableRides.length}'
                  : null,
            ),
            const SizedBox(height: 12),
            _buildActionCard(
              Icons.account_balance_wallet_outlined,
              'Earnings & Trip History',
              'View completed trips and payout summaries',
              () => context.push('/driver-financials'),
            ),
            const SizedBox(height: 12),
            _buildActionCard(
              Icons.person_outline,
              'Driver & Partner Profile',
              'Update license, personal details, and business bio',
              () => context.push('/driver-onboarding'),
            ),
            const SizedBox(height: 12),
            _buildActionCard(
              Icons.folder_open,
              'KYC Verification Documents',
              'Upload and review verification documents',
              () => context.push('/driver-documents'),
            ),
            const SizedBox(height: 12),
            _buildActionCard(
              Icons.directions_car_outlined,
              'Vehicle Fleet',
              'Manage registered vehicles and sectors',
              () => context.push('/driver-vehicles'),
            ),
            const SizedBox(height: 12),
            _buildActionCard(
              Icons.chat_bubble_outline,
              'Driver AI Assistant',
              'Instant driver support and policy guidelines',
              () => context.push('/ai-assistant/driver'),
            ),

            const SizedBox(height: 24),

            // 5. Online / Offline Status Indication
            if (partner != null && isApproved)
              if (isOnline) _buildWaitingForRides() else _buildOfflineMessage(),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveBookingCard(BuildContext context, dynamic ride) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.primaryDark,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryGreen.withOpacity(0.2),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.directions_car, color: AppColors.primaryGreen, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'ACTIVE TRIP IN PROGRESS',
                    style: TextStyle(
                      color: AppColors.primaryGreen,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: Colors.white10,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  ride.status.name.toString().toUpperCase(),
                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Pickup: ${ride.pickupAddress ?? "${ride.pickup.latitude}, ${ride.pickup.longitude}"}',
            style: const TextStyle(color: Colors.white70, fontSize: 13),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            'Destination: ${ride.destinationAddress ?? "${ride.destination.latitude}, ${ride.destination.longitude}"}',
            style: const TextStyle(color: Colors.white70, fontSize: 13),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => context.push('/driver-ride-request'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryGreen,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text('Open Ride Control Panel', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEarningsSummaryCard(BuildContext context, DriverDashboardState state) {
    final history = state.history;
    final totalEarnings = history?.totalEarnings ?? 0.0;
    final totalTrips = history?.totalTrips ?? 0;

    return InfurnusCard(
      onTap: () => context.push('/driver-financials'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Earnings Overview', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              Icon(Icons.arrow_forward_ios, size: 14, color: Colors.grey[500]),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Total Completed', style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(
                      '₹${totalEarnings.toStringAsFixed(0)}',
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: AppColors.primaryGreen,
                      ),
                    ),
                  ],
                ),
              ),
              Container(width: 1, height: 40, color: Colors.grey[200]),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Total Trips', style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(
                      '$totalTrips',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildErrorBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.red[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red[200]!),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: Colors.red),
          const SizedBox(width: 12),
          Expanded(
            child: Text(message, style: const TextStyle(color: Colors.red, fontSize: 14)),
          ),
        ],
      ),
    );
  }

  Widget _buildNoPartnerCard(BuildContext context) {
    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.info_outline, color: Colors.orange, size: 28),
              SizedBox(width: 12),
              Text('Partner Profile Required', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'You do not have an active partner profile. Register as a partner to start driving with INFURNUS.',
            style: TextStyle(color: Colors.grey, fontSize: 14),
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () => context.push('/driver-onboarding'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primaryGreen,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text('Complete Driver Onboarding'),
          ),
        ],
      ),
    );
  }

  Widget _buildPartnerStatusCard(BuildContext context, dynamic partner) {
    final String status = partner.approvalStatus;
    Color statusColor = Colors.orange;
    String statusTitle = 'Application Under Review';
    String statusDesc = 'Your partner profile is currently being reviewed by admin.';

    if (status == 'approved') {
      statusColor = AppColors.primaryGreen;
      statusTitle = 'Partner Account Approved';
      statusDesc = 'You are verified and eligible to accept rides.';
    } else if (status == 'rejected') {
      statusColor = Colors.red;
      statusTitle = 'Application Rejected';
      statusDesc = 'Your partner application was not approved. Contact support for details.';
    } else if (status == 'pending') {
      statusColor = Colors.amber;
      statusTitle = 'Application Pending';
      statusDesc = 'Please complete your document submission to proceed.';
    }

    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.verified_user, color: statusColor, size: 24),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(partner.businessName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    Text(statusTitle, style: TextStyle(color: statusColor, fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  status.toUpperCase(),
                  style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(statusDesc, style: TextStyle(color: Colors.grey[600], fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildVehicleCard(BuildContext context, dynamic vehicle) {
    if (vehicle == null) {
      return InfurnusCard(
        child: Row(
          children: [
            const Icon(Icons.directions_car_outlined, color: Colors.grey, size: 32),
            const SizedBox(width: 16),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('No Active Vehicle', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  Text('Register a vehicle to go online', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
            OutlinedButton(
              onPressed: () => context.push('/driver-onboarding'),
              child: const Text('Setup Vehicle'),
            ),
          ],
        ),
      );
    }

    return InfurnusCard(
      child: Row(
        children: [
          const Icon(Icons.directions_car, color: AppColors.primaryGreen, size: 32),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${vehicle.make} ${vehicle.model}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text('Plate: ${vehicle.plateNumber}', style: TextStyle(color: Colors.grey[600], fontSize: 13)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: vehicle.isActive ? Colors.green[50] : Colors.grey[100],
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              vehicle.isActive ? 'ACTIVE' : 'INACTIVE',
              style: TextStyle(
                color: vehicle.isActive ? Colors.green : Colors.grey,
                fontWeight: FontWeight.bold,
                fontSize: 11,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionCard(
    IconData icon,
    String title,
    String subtitle,
    VoidCallback onTap, {
    String? badge,
  }) {
    return InfurnusCard(
      onTap: onTap,
      child: Row(
        children: [
          Icon(icon, color: AppColors.primaryGreen),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
                Text(subtitle, style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
          ),
          if (badge != null) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.primaryGreen,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                badge,
                style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
              ),
            ),
            const SizedBox(width: 8),
          ],
          const Icon(Icons.chevron_right, color: Colors.grey),
        ],
      ),
    );
  }

  Widget _buildOfflineMessage() {
    return const Column(
      children: [
        Icon(Icons.cloud_off, size: 48, color: Colors.grey),
        SizedBox(height: 12),
        Text('You are currently offline', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
        Text('Toggle the switch above to go online and receive requests', style: TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildWaitingForRides() {
    return const Column(
      children: [
        CircularProgressIndicator(color: AppColors.primaryGreen),
        SizedBox(height: 12),
        Text('Searching for nearby ride requests...', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
      ],
    );
  }
}
