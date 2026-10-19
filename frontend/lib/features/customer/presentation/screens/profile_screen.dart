import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  static const Color mainBg = Color(0xFFF9FAFB);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE5E7EB);
  static const Color textBlack = Color(0xFF111827);
  static const Color textGray = Color(0xFF6B7280);
  static const Color brandGreen = Color(0xFF16A34A);
  static const Color serviceRed = Color(0xFFDC2626);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(userProvider);

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        backgroundColor: const Color(0xFF032213),
        elevation: 0,
        centerTitle: false,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
          onPressed: () => context.pop(),
        ),
        title: const Text(
          'Profile & Settings',
          style: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            // 1. Dark Emerald Header with Avatar & Wave Aura
            Container(
              width: double.infinity,
              padding: const EdgeInsets.only(top: 16, bottom: 28, left: 24, right: 24),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0xFF032213), Color(0xFF063B23), Color(0xFF0A4F30)],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
              child: Column(
                children: [
                  Stack(
                    alignment: Alignment.bottomRight,
                    children: [
                      Container(
                        width: 84,
                        height: 84,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFF16A34A), width: 2.5),
                          color: const Color(0xFF0F5132),
                        ),
                        child: const Center(
                          child: Icon(Icons.person_rounded, size: 48, color: Colors.white),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.all(5),
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.camera_alt_rounded,
                          size: 14,
                          color: Color(0xFF0F5132),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    user != null ? '${user.firstName} ${user.lastName}' : 'Test Customer',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    user?.phone ?? '+91 7301301936',
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFFA7F3D0),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

            // 2. Menu Group Cards
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 16.0),
              child: Column(
                children: [
                  // Group 1: Personal, History, Wallet, Payment Methods
                  _buildSectionCard([
                    _buildTile(Icons.person_outline_rounded, 'Personal Information', () {}),
                    _buildTile(Icons.history_rounded, 'Ride History', () => context.push('/booking-history')),
                    _buildTile(Icons.account_balance_wallet_outlined, 'Wallet & Pay', () => context.push('/wallet')),
                    _buildTile(Icons.payment_rounded, 'Payment Methods', () => context.push('/wallet'), showDivider: false),
                  ]),
                  const SizedBox(height: 14),

                  // Group 2: Notifications, Privacy, Help, Terms
                  _buildSectionCard([
                    _buildTile(Icons.notifications_outlined, 'Notifications', () {}),
                    _buildTile(Icons.shield_outlined, 'Privacy Settings', () {}),
                    _buildTile(Icons.help_outline_rounded, 'Help & Support', () => context.push('/support')),
                    _buildTile(Icons.info_outline_rounded, 'Privacy Policy', () => context.push('/legal/privacy')),
                    _buildTile(Icons.description_outlined, 'Terms & Conditions', () => context.push('/legal/terms'), showDivider: false),
                  ]),
                  const SizedBox(height: 14),

                  // Group 3: Delete Account, Logout
                  _buildSectionCard([
                    _buildTile(
                      Icons.delete_outline_rounded,
                      'Delete Account',
                      () => context.push('/delete-account'),
                      isDestructive: true,
                    ),
                    _buildTile(
                      Icons.logout_rounded,
                      'Logout',
                      () async {
                        await ref.read(authProvider.notifier).logout();
                        if (context.mounted) context.go('/login');
                      },
                      isDestructive: true,
                      showDivider: false,
                    ),
                  ]),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionCard(List<Widget> children) {
    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCard),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(children: children),
    );
  }

  Widget _buildTile(
    IconData icon,
    String title,
    VoidCallback onTap, {
    bool isDestructive = false,
    bool showDivider = true,
  }) {
    return Column(
      children: [
        ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
          leading: Icon(icon, color: isDestructive ? serviceRed : textBlack, size: 20),
          title: Text(
            title,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 14,
              color: isDestructive ? serviceRed : textBlack,
            ),
          ),
          trailing: Icon(
            Icons.chevron_right_rounded,
            size: 20,
            color: isDestructive ? serviceRed : const Color(0xFF9CA3AF),
          ),
          onTap: onTap,
        ),
        if (showDivider)
          const Divider(height: 1, thickness: 1, color: borderCard, indent: 54, endIndent: 16),
      ],
    );
  }
}
