import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';

class DriverDashboardScreen extends ConsumerStatefulWidget {
  const DriverDashboardScreen({super.key});

  @override
  ConsumerState<DriverDashboardScreen> createState() => _DriverDashboardScreenState();
}

class _DriverDashboardScreenState extends ConsumerState<DriverDashboardScreen> {
  bool isOnline = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Driver Dashboard'),
        actions: [
          Switch(
            value: isOnline,
            onChanged: (val) => setState(() => isOnline = val),
            activeColor: AppColors.primaryGreen,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            _buildEarningsCard(),
            const SizedBox(height: 20),
            _buildStatsGrid(),
            const SizedBox(height: 20),
            _buildActionCard(Icons.assignment_ind, 'Onboarding & KYC', 'Complete your profile', () => context.push('/driver-onboarding')),
            const SizedBox(height: 12),
            _buildActionCard(Icons.chat_bubble_outline, 'Driver AI Assistant', 'Get help with your rides', () => context.push('/ai-assistant/driver')),
            const SizedBox(height: 30),
            if (isOnline) _buildWaitingForRides() else _buildOfflineMessage(),
          ],
        ),
      ),
    );
  }

  Widget _buildActionCard(IconData icon, String title, String subtitle, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: Colors.grey[200]!),
          borderRadius: BorderRadius.circular(12),
        ),
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
      ),
    );
  }

  Widget _buildEarningsCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.primaryDark,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Column(
        children: [
          Text("Today's Earnings", style: TextStyle(color: Colors.white70)),
          SizedBox(height: 8),
          Text('₹1,450.00', style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildStatsGrid() {
    return Row(
      children: [
        Expanded(child: _statItem('Rides', '12', Icons.directions_car)),
        const SizedBox(width: 16),
        Expanded(child: _statItem('Rating', '4.9', Icons.star)),
      ],
    );
  }

  Widget _statItem(String label, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey[100],
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(icon, color: AppColors.primaryGreen),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          Text(label, style: const TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildOfflineMessage() {
    return const Column(
      children: [
        Icon(Icons.cloud_off, size: 64, color: Colors.grey),
        SizedBox(height: 16),
        Text('You are currently offline', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
        Text('Go online to start receiving ride requests', style: TextStyle(color: Colors.grey)),
      ],
    );
  }

  Widget _buildWaitingForRides() {
    return const Column(
      children: [
        CircularProgressIndicator(color: AppColors.primaryGreen),
        SizedBox(height: 16),
        Text('Searching for nearby requests...', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
      ],
    );
  }
}
