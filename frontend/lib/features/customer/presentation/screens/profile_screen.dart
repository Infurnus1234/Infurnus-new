import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  static const Color mainBg = Color(0xFFF8FAFC);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE2E8F0);
  static const Color textBlack = Color(0xFF111827);
  static const Color textGray = Color(0xFF6B7280);
  static const Color brandGreen = Color(0xFF10B981);
  static const Color serviceRed = Color(0xFFDC2626);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(userProvider);

    return Scaffold(
      backgroundColor: mainBg,
      body: SingleChildScrollView(
        child: Column(
          children: [
            // 1. Dark Emerald Header with Avatar
            Container(
              width: double.infinity,
              padding: const EdgeInsets.only(top: 60, bottom: 32, left: 24, right: 24),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0xFF022C22), Color(0xFF064E3B), Color(0xFF047857)],
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
                        width: 88,
                        height: 88,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFF10B981), width: 3),
                          color: const Color(0xFF064E3B),
                        ),
                        child: const Center(
                          child: Icon(Icons.person_rounded, size: 48, color: Colors.white),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.camera_alt_rounded, size: 14, color: Color(0xFF064E3B)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    user != null ? '${user.firstName} ${user.lastName}' : 'Test Customer',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    user?.phone ?? '+917301301936',
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFFA7F3D0),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

            // 2. Menu Options Card Sections
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                children: [
                  _buildSectionCard([
                    _buildTile(Icons.person_outline_rounded, 'Personal Information', () => context.push('/profile/personal')),
                    _buildTile(Icons.history_rounded, 'Ride History', () => context.push('/booking-history')),
                    _buildTile(Icons.account_balance_wallet_outlined, 'Wallet & Pay', () => context.push('/wallet')),
                    _buildTile(Icons.payment_rounded, 'Payment Methods', () => context.push('/wallet')),
                  ]),
                  const SizedBox(height: 16),
                  _buildSectionCard([
                    _buildTile(Icons.notifications_outlined, 'Notifications', () => {}),
                    _buildTile(Icons.security_rounded, 'Privacy Settings', () => context.push('/privacy-settings')),
                    _buildTile(Icons.help_outline_rounded, 'Help & Support', () => context.push('/support')),
                    _buildTile(Icons.info_outline_rounded, 'Privacy Policy', () => context.push('/legal/privacy')),
                    _buildTile(Icons.description_outlined, 'Terms & Conditions', () => context.push('/legal/terms')),
                  ]),
                  const SizedBox(height: 16),
                  _buildSectionCard([
                    _buildTile(Icons.delete_outline_rounded, 'Delete Account', () => context.push('/delete-account'), isDestructive: true),
                    _buildTile(Icons.logout_rounded, 'Logout', () async {
                      await ref.read(authProvider.notifier).logout();
                      if (context.mounted) context.go('/login');
                    }, isDestructive: true, showDivider: false),
                  ]),
                  const SizedBox(height: 32),
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
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderCard),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(children: children),
    );
  }

  Widget _buildTile(IconData icon, String title, VoidCallback onTap, {bool isDestructive = false, bool showDivider = true}) {
    return Column(
      children: [
        ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
          leading: Icon(icon, color: isDestructive ? serviceRed : textBlack, size: 22),
          title: Text(
            title,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: isDestructive ? serviceRed : textBlack,
            ),
          ),
          trailing: Icon(Icons.arrow_forward_ios_rounded, size: 14, color: isDestructive ? serviceRed : textGray),
          onTap: onTap,
        ),
        if (showDivider)
          const Divider(height: 1, thickness: 1, color: borderCard, indent: 56, endIndent: 20),
      ],
    );
  }
}
