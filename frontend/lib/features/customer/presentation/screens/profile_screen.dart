import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color borderCard = Color(0xFF262626);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color brandGreen = Color(0xFF22C55E);
  static const Color serviceRed = Color(0xFFEF4444);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(userProvider);

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Text(
          'Profile',
          style: TextStyle(color: textWhite, fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF050505),
        foregroundColor: textWhite,
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
        children: [
          Center(
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: brandGreen.withValues(alpha: 0.5),
                  width: 2,
                ),
              ),
              child: CircleAvatar(
                radius: 46,
                backgroundColor: brandGreen.withValues(alpha: 0.2),
                child: const Icon(
                  Icons.person_rounded,
                  size: 48,
                  color: brandGreen,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(
              user != null
                  ? '${user.firstName} ${user.lastName}'
                  : 'User Account',
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w900,
                color: textWhite,
              ),
            ),
          ),
          if (user?.phone != null) ...[
            const SizedBox(height: 4),
            Center(
              child: Text(
                user!.phone!,
                style: const TextStyle(
                  fontSize: 13,
                  color: textGray,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
          const SizedBox(height: 28),

          Container(
            decoration: BoxDecoration(
              color: cardBg,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: borderCard),
            ),
            child: Column(
              children: [
                _buildListTile(
                  Icons.person_outline_rounded,
                  'Personal Information',
                  onTap: () {},
                ),
                const Divider(height: 1, color: borderCard),
                _buildListTile(
                  Icons.history_rounded,
                  'Ride History',
                  onTap: () => context.push('/booking-history'),
                ),
                const Divider(height: 1, color: borderCard),
                _buildListTile(
                  Icons.account_balance_wallet_outlined,
                  'Wallet & Pay',
                  onTap: () => context.push('/wallet'),
                ),
                const Divider(height: 1, color: borderCard),
                _buildListTile(
                  Icons.payment_rounded,
                  'Payment Methods',
                  onTap: () {},
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          Container(
            decoration: BoxDecoration(
              color: cardBg,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: borderCard),
            ),
            child: Column(
              children: [
                _buildListTile(
                  Icons.security_rounded,
                  'Privacy Settings',
                  onTap: () {},
                ),
                const Divider(height: 1, color: borderCard),
                _buildListTile(
                  Icons.help_outline_rounded,
                  'Help & Support',
                  onTap: () => context.push('/support'),
                ),
                const Divider(height: 1, color: borderCard),
                _buildListTile(
                  Icons.info_outline_rounded,
                  'Privacy Policy',
                  onTap: () => context.push('/legal/Privacy Policy'),
                ),
                const Divider(height: 1, color: borderCard),
                _buildListTile(
                  Icons.description_outlined,
                  'Terms & Conditions',
                  onTap: () => context.push('/legal/Terms and Conditions'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          Container(
            decoration: BoxDecoration(
              color: cardBg,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: borderCard),
            ),
            child: Column(
              children: [
                _buildListTile(
                  Icons.delete_forever_rounded,
                  'Delete Account',
                  textColor: serviceRed,
                  onTap: () => context.push('/delete-account'),
                ),
                const Divider(height: 1, color: borderCard),
                _buildListTile(
                  Icons.logout_rounded,
                  'Logout',
                  textColor: serviceRed,
                  onTap: () => ref.read(authProvider.notifier).logout(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildListTile(
    IconData icon,
    String title, {
    Color? textColor,
    VoidCallback? onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: textColor ?? textWhite, size: 22),
      title: Text(
        title,
        style: TextStyle(
          color: textColor ?? textWhite,
          fontWeight: FontWeight.bold,
          fontSize: 14,
        ),
      ),
      trailing: Icon(
        Icons.chevron_right_rounded,
        size: 20,
        color: textColor ?? textGray,
      ),
      onTap: onTap,
    );
  }
}
