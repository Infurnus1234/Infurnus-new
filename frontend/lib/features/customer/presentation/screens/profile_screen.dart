import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../../core/network/dio_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/data/models/auth_models.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../../../auth/domain/entities/user.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  Future<void> _showPersonalInfoModal(
    BuildContext context,
    User? user,
    WidgetRef ref,
  ) async {
    if (user == null) return;
    var saving = false;
    String? saveError;
    ModalRoute<dynamic>? sheetRoute;
    final firstNameController = TextEditingController(text: user.firstName);
    final lastNameController = TextEditingController(text: user.lastName);
    final emailController = TextEditingController(text: user.email ?? '');
    final phoneController = TextEditingController(text: user.phone ?? '');

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        sheetRoute = ModalRoute.of(context);
        return Padding(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: StatefulBuilder(
            builder: (dialogContext, updateDialog) => SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Personal Information',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF111827),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close_rounded, color: Color(0xFF111827)),
                        onPressed: () => Navigator.pop(context),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: firstNameController,
                          style: const TextStyle(color: Color(0xFF111827)),
                          decoration: const InputDecoration(
                            labelText: 'First Name',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: lastNameController,
                          style: const TextStyle(color: Color(0xFF111827)),
                          decoration: const InputDecoration(
                            labelText: 'Last Name',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: emailController,
                    style: const TextStyle(color: Color(0xFF111827)),
                    decoration: const InputDecoration(
                      labelText: 'Email Address',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: phoneController,
                    style: const TextStyle(color: Color(0xFF111827)),
                    decoration: const InputDecoration(
                      labelText: 'Phone Number',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primaryGreen,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      onPressed: saving
                          ? null
                          : () async {
                              final firstName = firstNameController.text.trim();
                              final lastName = lastNameController.text.trim();
                              if (firstName.isEmpty || lastName.isEmpty) {
                                updateDialog(
                                  () => saveError = 'First and last names are required.',
                                );
                                return;
                              }
                              updateDialog(() {
                                saving = true;
                                saveError = null;
                              });
                              try {
                                final response = await ref.read(dioProvider).patch(
                                  '/users/${user.id}',
                                  data: {
                                    'firstName': firstName,
                                    'lastName': lastName,
                                    if (emailController.text.trim() != (user.email ?? ''))
                                      'email': emailController.text.trim(),
                                    if (phoneController.text.trim() != (user.phone ?? ''))
                                      'phone': phoneController.text.trim(),
                                  },
                                );
                                final updated = PublicUser.fromJson(
                                  Map<String, dynamic>.from(
                                    response.data['data'] as Map,
                                  ),
                                );
                                ref
                                    .read(userProvider.notifier)
                                    .setUser(updated.toEntity(user.role));
                                if (!dialogContext.mounted) return;
                                Navigator.pop(dialogContext);
                                if (!context.mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Personal information updated.'),
                                    backgroundColor: AppColors.primaryGreen,
                                  ),
                                );
                              } catch (error) {
                                if (!dialogContext.mounted) return;
                                updateDialog(() => saveError = 'Save failed. Retry.');
                              } finally {
                                if (dialogContext.mounted) {
                                  updateDialog(() => saving = false);
                                }
                              }
                            },
                      child: const Text(
                        'Save Details',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                  if (saving) const LinearProgressIndicator(),
                  if (saveError != null)
                    Text(saveError!, style: const TextStyle(color: Colors.red)),
                ],
              ),
            ),
          ),
        );
      },
    );
    await sheetRoute?.completed;
    firstNameController.dispose();
    lastNameController.dispose();
    emailController.dispose();
    phoneController.dispose();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(userProvider);
    final userName = user != null ? '${user.firstName} ${user.lastName}' : 'Test Customer';
    final userPhone = user?.phone ?? '+91 7301301936';

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Top Dark Hero Section
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: MediaQuery.of(context).size.height * 0.38,
            child: Container(
              decoration: const BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(0, -0.2),
                  radius: 0.95,
                  colors: [
                    Color(0xFF062A14),
                    Color(0xFF000000),
                  ],
                ),
              ),
              child: SafeArea(
                child: Column(
                  children: [
                    Row(
                      children: [
                        IconButton(
                          icon: const Icon(Icons.arrow_back, color: Colors.white),
                          onPressed: () => context.pop(),
                        ),
                        const SizedBox(width: 8),
                        const Text(
                          'Profile & Settings',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // Avatar Ring with Camera Badge
                    Stack(
                      children: [
                        Container(
                          width: 88,
                          height: 88,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: AppColors.primaryGreen,
                              width: 2.5,
                            ),
                          ),
                          child: const CircleAvatar(
                            backgroundColor: Color(0xFF0F391E),
                            child: Icon(
                              Icons.person_rounded,
                              size: 52,
                              color: AppColors.primaryGreen,
                            ),
                          ),
                        ),
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: Container(
                            padding: const EdgeInsets.all(4),
                            decoration: const BoxDecoration(
                              color: Colors.black,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.camera_alt,
                              size: 16,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    Text(
                      userName,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      userPhone,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Color(0xFF9CA3AF),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Bottom White Sheet Container
          Positioned.fill(
            top: MediaQuery.of(context).size.height * 0.32,
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                children: [
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFE5E7EB)),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x08000000),
                          blurRadius: 10,
                          offset: Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        _buildSettingsRow(
                          Icons.person_outline_rounded,
                          'Personal Information',
                          onTap: () => _showPersonalInfoModal(context, user, ref),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.history_rounded,
                          'Ride History',
                          onTap: () => context.push('/booking-history'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.account_balance_wallet_outlined,
                          'Wallet & Pay',
                          onTap: () => context.push('/wallet'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.payment_rounded,
                          'Payment Methods',
                          onTap: () => context.push('/wallet'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.notifications_none_rounded,
                          'Notifications',
                          onTap: () => context.push('/notifications-permission'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.security_rounded,
                          'Privacy Settings',
                          onTap: () async {
                            try {
                              if (await openAppSettings()) return;
                            } catch (_) {}
                          },
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.help_outline_rounded,
                          'Help & Support',
                          onTap: () => context.push('/support'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.info_outline_rounded,
                          'Privacy Policy',
                          onTap: () => context.push('/legal/Privacy Policy'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.description_outlined,
                          'Terms & Conditions',
                          onTap: () => context.push('/legal/Terms and Conditions'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.delete_outline_rounded,
                          'Delete Account',
                          textColor: const Color(0xFFEF4444),
                          onTap: () => context.push('/delete-account'),
                        ),
                        const Divider(height: 1, color: Color(0xFFF3F4F6)),
                        _buildSettingsRow(
                          Icons.logout_rounded,
                          'Logout',
                          textColor: const Color(0xFFEF4444),
                          onTap: () => ref.read(authProvider.notifier).logout(),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingsRow(
    IconData icon,
    String title, {
    Color? textColor,
    VoidCallback? onTap,
  }) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
      leading: Icon(icon, color: textColor ?? const Color(0xFF111827), size: 22),
      title: Text(
        title,
        style: TextStyle(
          color: textColor ?? const Color(0xFF111827),
          fontWeight: FontWeight.w600,
          fontSize: 15,
        ),
      ),
      trailing: Icon(
        Icons.chevron_right_rounded,
        size: 20,
        color: textColor ?? const Color(0xFF9CA3AF),
      ),
      onTap: onTap,
    );
  }
}
