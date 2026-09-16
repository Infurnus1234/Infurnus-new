import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../providers/ride_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';

class CustomerHomeScreen extends ConsumerWidget {
  const CustomerHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(userProvider);
    
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: AppColors.primaryGreen,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          'N',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        'INFURNUS',
                        style: TextStyle(
                          color: Colors.black,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 1,
                        ),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.chat_bubble_outline, size: 24),
                        onPressed: () => context.push('/ai-assistant/customer'),
                      ),
                      IconButton(
                        icon: const Icon(Icons.account_balance_wallet_outlined, size: 24),
                        onPressed: () => context.push('/wallet'),
                      ),
                      IconButton(
                        icon: const Icon(Icons.person_outline, size: 24),
                        onPressed: () => context.push('/profile'),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 24),
              
              // Greeting and Toggle
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Good Morning',
                        style: TextStyle(color: Colors.grey, fontSize: 14),
                      ),
                      Text(
                        '${user?.firstName ?? "Niranjan"} 👋',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  // Role Toggle
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(20),
                    ),
                    padding: const EdgeInsets.all(4),
                    child: Row(
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
              const SizedBox(height: 32),
              
              // Search Bar
              const Text(
                'Where are you going?',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              GestureDetector(
                onTap: () {
                  ref.read(rideProvider.notifier).setRoute('Current Location', 'Airport Terminal 1');
                  context.push('/ride-booking');
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                  decoration: BoxDecoration(
                    color: Colors.grey[50],
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.grey[200]!),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.search, color: Colors.black54),
                      SizedBox(width: 12),
                      Text(
                        'Search destination',
                        style: TextStyle(color: Colors.black54, fontSize: 16),
                      ),
                      Spacer(),
                      Icon(Icons.tune, color: Colors.black54, size: 20),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 32),
              
              // Services
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildServiceCard('Ride', 'Get a ride\nanywhere', Icons.directions_car, Colors.green[50]!, AppColors.primaryGreen, () {}),
                  _buildServiceCard('Rentals', 'Vehicles for\nhours or days', Icons.key, Colors.blue[50]!, Colors.blue, () => context.push('/rentals')),
                  _buildServiceCard('Logistics', 'Send anything\nanywhere', Icons.local_shipping, Colors.orange[50]!, Colors.orange, () => context.push('/logistics')),
                ],
              ),
              const SizedBox(height: 40),
              
              // Recent Bookings
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Recent Bookings',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  TextButton(
                    onPressed: () => context.push('/booking-history'),
                    child: const Text('View All', style: TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              
              // Empty state for bookings
              Center(
                child: Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.grey[50],
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Icon(Icons.receipt_long_outlined, size: 40, color: Colors.grey),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'No recent bookings',
                      style: TextStyle(fontWeight: FontWeight.bold, color: Colors.black87),
                    ),
                    const Text(
                      'Your bookings will appear here',
                      style: TextStyle(color: Colors.grey, fontSize: 12),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(
        selectedItemColor: Colors.black,
        unselectedItemColor: Colors.grey,
        currentIndex: 0,
        type: BottomNavigationBarType.fixed,
        showSelectedLabels: true,
        showUnselectedLabels: true,
        selectedFontSize: 12,
        unselectedFontSize: 12,
        onTap: (index) {
          if (index == 1) context.push('/booking-history');
          if (index == 2) context.push('/wallet');
          if (index == 3) context.push('/profile');
        },
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home_filled), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.assignment_outlined), label: 'Bookings'),
          BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_outlined), label: 'Wallet'),
          BottomNavigationBarItem(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
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

  Widget _buildServiceCard(String title, String desc, IconData icon, Color bgColor, Color iconColor, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 105,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.grey[100]!),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 10, offset: const Offset(0, 4)),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: iconColor, size: 24),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 4),
            Text(
              desc,
              style: const TextStyle(color: Colors.grey, fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }
}
