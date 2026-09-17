import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../providers/driver_dashboard_provider.dart';

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
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primaryGreen),
                    )
                  else
                    Switch(
                      value: isOnline,
                      onChanged: (val) {
                        final newStatus = val ? 'available' : 'offline';
                        ref.read(driverDashboardProvider.notifier).updateAvailability(newStatus);
                      },
                      activeTrackColor: AppColors.primaryGreen,
                    ),
                ],
              ),
            ),
        ],
      ),
      body: _buildBody(context, user, dashboardState, partner, vehicle, isApproved, isOnline),
    );
  }

  Widget _buildBody(
    BuildContext context,
    dynamic user,
    DriverDashboardState state,
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

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Welcome, ${user?.firstName ?? "Driver"}',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),

          if (state.errorMessage != null) _buildErrorBanner(state.errorMessage!),

          // 1. Partner Status / Onboarding CTA
          if (partner == null)
            _buildNoPartnerCard(context)
          else
            _buildPartnerStatusCard(context, partner),

          const SizedBox(height: 16),

          // 2. Vehicle Card
          if (partner != null && isApproved) _buildVehicleCard(context, vehicle),

          const SizedBox(height: 16),

          // 3. Quick Action Cards
          _buildActionCard(
            Icons.person_outline,
            'Partner Profile',
            'View and edit business details',
            () => context.push('/driver-profile'),
          ),
          const SizedBox(height: 12),
          _buildActionCard(
            Icons.folder_open,
            'KYC Documents Metadata',
            'Manage partner verification documents',
            () => context.push('/driver-documents'),
          ),
          const SizedBox(height: 12),
          _buildActionCard(
            Icons.directions_car_outlined,
            'Vehicle Fleet',
            'Manage registered vehicles',
            () => context.push('/driver-vehicles'),
          ),
          const SizedBox(height: 12),
          _buildActionCard(
            Icons.local_taxi,
            'Ride Panel & Accept Requests',
            'Accept ride requests and manage trip status',
            () => context.push('/driver-ride-request'),
          ),
          const SizedBox(height: 12),
          _buildActionCard(
            Icons.account_balance_wallet_outlined,
            'Earnings & History',
            'View financial status',
            () => context.push('/driver-financials'),
          ),
          const SizedBox(height: 12),
          _buildActionCard(
            Icons.notifications_none_outlined,
            'Notifications & Settings',
            'Manage communication preferences & activity history',
            () => context.push('/driver-notifications'),
          ),
          const SizedBox(height: 12),
          _buildActionCard(
            Icons.chat_bubble_outline,
            'Driver AI Assistant',
            'Get support and answer questions',
            () => context.push('/ai-assistant/driver'),
          ),

          const SizedBox(height: 24),

          // 4. Online / Offline State Display
          if (partner != null && isApproved)
            if (isOnline) _buildWaitingForRides() else _buildOfflineMessage(),
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
            child: const Text('Become a Partner'),
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
              onPressed: () {
                // Future vehicle setup
              },
              child: const Text('Setup'),
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

  Widget _buildActionCard(IconData icon, String title, String subtitle, VoidCallback onTap) {
    return InfurnusCard(
      onTap: onTap,
      child: Row(
        children: [
          Icon(icon, color: AppColors.primaryGreen),
          const SizedBox(width: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
              Text(subtitle, style: const TextStyle(color: Colors.grey, fontSize: 12)),
            ],
          ),
          const Spacer(),
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
