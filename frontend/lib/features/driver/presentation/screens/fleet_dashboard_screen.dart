import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../data/models/fleet_dashboard_model.dart';
import '../../data/models/fleet_earnings_model.dart';
import '../providers/driver_providers.dart';

final fleetDashboardFutureProvider =
    FutureProvider.autoDispose<FleetDashboardModel>((ref) async {
  final ds = ref.watch(driverRemoteDataSourceProvider);
  return ds.getFleetDashboard();
});

final fleetEarningsFutureProvider =
    FutureProvider.autoDispose<FleetEarningsModel>((ref) async {
  final ds = ref.watch(driverRemoteDataSourceProvider);
  return ds.getFleetEarnings();
});

class FleetDashboardScreen extends ConsumerWidget {
  const FleetDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboardAsync = ref.watch(fleetDashboardFutureProvider);
    final earningsAsync = ref.watch(fleetEarningsFutureProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Fleet Owner Portal'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(fleetDashboardFutureProvider);
              ref.invalidate(fleetEarningsFutureProvider);
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(fleetDashboardFutureProvider);
          ref.invalidate(fleetEarningsFutureProvider);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Hero Earnings & Revenue Summary
              earningsAsync.when(
                loading: () => const InfurnusLoader(message: 'Loading fleet financials...'),
                error: (err, _) => InfurnusCard(child: Text('Earnings error: $err')),
                data: (earnings) => _buildEarningsHero(context, earnings),
              ),

              const SizedBox(height: 20),

              // Fleet Vehicle & Driver KPI Grid
              dashboardAsync.when(
                loading: () => const InfurnusLoader(message: 'Loading fleet status...'),
                error: (err, _) => InfurnusErrorView(
                  message: err.toString(),
                  onRetry: () => ref.refresh(fleetDashboardFutureProvider),
                ),
                data: (metrics) => _buildMetricsGrid(context, metrics),
              ),

              const SizedBox(height: 24),
              const Text('Fleet Management', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),

              _buildNavCard(
                context,
                icon: Icons.directions_car,
                title: 'Manage Fleet Vehicles',
                subtitle: 'Add vehicles, assign drivers & generate assignment codes',
                route: '/fleet-vehicles',
              ),
              const SizedBox(height: 12),
              _buildNavCard(
                context,
                icon: Icons.people,
                title: 'Fleet Drivers',
                subtitle: 'Monitor assigned drivers, availability & performance',
                route: '/fleet-drivers',
              ),
              const SizedBox(height: 12),
              _buildNavCard(
                context,
                icon: Icons.account_balance,
                title: 'Bank & Payout Details',
                subtitle: 'Configure settlement bank account for weekly payouts',
                route: '/provider-bank-account',
              ),
              const SizedBox(height: 12),
              _buildNavCard(
                context,
                icon: Icons.support_agent,
                title: 'Support & Helpdesk',
                subtitle: 'Submit tickets and queries to operations team',
                route: '/support-tickets',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEarningsHero(BuildContext context, FleetEarningsModel earnings) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF162B20), Color(0xFF0C1913)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.primaryGreen.withOpacity(0.35)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryGreen.withOpacity(0.12),
            blurRadius: 16,
            offset: const Offset(0, 6),
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
                  Icon(Icons.monetization_on, color: AppColors.primaryGreen, size: 22),
                  SizedBox(width: 8),
                  Text(
                    'MONTHLY NET PAYOUT',
                    style: TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1),
                  ),
                ],
              ),
              Text(
                '${earnings.totalTrips} Trips',
                style: const TextStyle(color: AppColors.primaryGreen, fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            '₹${earnings.netPayout.toStringAsFixed(2)}',
            style: const TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w900,
              color: Colors.white,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 16),
          const Divider(color: Colors.white12),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildSubStat('Today Revenue', '₹${earnings.todayRevenue.toStringAsFixed(0)}'),
              _buildSubStat('Week Revenue', '₹${earnings.thisWeekRevenue.toStringAsFixed(0)}'),
              _buildSubStat('Commission', '₹${earnings.platformCommission.toStringAsFixed(0)}'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSubStat(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 11)),
        const SizedBox(height: 3),
        Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
      ],
    );
  }

  Widget _buildMetricsGrid(BuildContext context, FleetDashboardModel metrics) {
    return GridView.count(
      crossAxisCount: 2,
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 1.55,
      children: [
        _buildMetricTile('Total Vehicles', '${metrics.totalVehicles}', Icons.directions_car, Colors.blue),
        _buildMetricTile('Active Vehicles', '${metrics.activeVehicles}', Icons.check_circle, AppColors.primaryGreen),
        _buildMetricTile('Total Drivers', '${metrics.totalDrivers}', Icons.people, Colors.purple),
        _buildMetricTile('Available Drivers', '${metrics.availableDrivers}', Icons.person_pin, Colors.teal),
      ],
    );
  }

  Widget _buildMetricTile(String title, String count, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A221E),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: TextStyle(color: Colors.grey[400], fontSize: 12)),
              Icon(icon, color: color, size: 18),
            ],
          ),
          Text(
            count,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white),
          ),
        ],
      ),
    );
  }

  Widget _buildNavCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required String route,
  }) {
    return InfurnusCard(
      onTap: () => context.push(route),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.primaryGreen.withOpacity(0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: AppColors.primaryGreen, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                const SizedBox(height: 3),
                Text(subtitle, style: TextStyle(color: Colors.grey[400], fontSize: 12)),
              ],
            ),
          ),
          const Icon(Icons.arrow_forward_ios, size: 14, color: Colors.grey),
        ],
      ),
    );
  }
}
