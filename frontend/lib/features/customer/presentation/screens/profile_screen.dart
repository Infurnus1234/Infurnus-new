import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/presentation/providers/auth_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        elevation: 0,
      ),
      body: ListView(
        children: [
          const SizedBox(height: 20),
          const Center(
            child: CircleAvatar(
              radius: 50,
              backgroundColor: AppColors.primaryGreen,
              child: Icon(Icons.person, size: 50, color: Colors.white),
            ),
          ),
          const SizedBox(height: 16),
          const Center(
            child: Text(
              'User Name',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 30),
          _buildListTile(Icons.person_outline, 'Personal Information', onTap: () {}),
          _buildListTile(Icons.history, 'Ride History', onTap: () => context.push('/booking-history')),
          _buildListTile(Icons.account_balance_wallet_outlined, 'Wallet', onTap: () => context.push('/wallet')),
          _buildListTile(Icons.payment, 'Payment Methods', onTap: () {}),
          const Divider(),
          _buildListTile(Icons.security, 'Privacy Settings', onTap: () {}),
          _buildListTile(Icons.delete_forever, 'Delete Account', textColor: Colors.red, onTap: () => context.push('/delete-account')),
          _buildListTile(Icons.help_outline, 'Help & Support', onTap: () => context.push('/support')),
          _buildListTile(Icons.info_outline, 'Privacy Policy', onTap: () => context.push('/legal/Privacy Policy')),
          _buildListTile(Icons.info_outline, 'Terms & Conditions', onTap: () => context.push('/legal/Terms and Conditions')),
          const Divider(),
          _buildListTile(
            Icons.logout, 
            'Logout', 
            textColor: Colors.red,
            onTap: () => ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
    );
  }

  Widget _buildListTile(IconData icon, String title, {Color? textColor, VoidCallback? onTap}) {
    return ListTile(
      leading: Icon(icon, color: textColor ?? AppColors.textPrimary),
      title: Text(
        title,
        style: TextStyle(color: textColor ?? AppColors.textPrimary, fontWeight: FontWeight.w500),
      ),
      trailing: const Icon(Icons.chevron_right, size: 20),
      onTap: onTap,
    );
  }
}
