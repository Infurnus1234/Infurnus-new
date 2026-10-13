import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:dio/dio.dart';

import '../../../../core/network/dio_client.dart';
import '../../../auth/data/models/auth_models.dart';

import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../../../auth/domain/entities/user.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color borderCard = Color(0xFF262626);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color brandGreen = Color(0xFF22C55E);
  static const Color serviceRed = Color(0xFFEF4444);

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
      backgroundColor: cardBg,
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
                          color: textWhite,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close_rounded, color: textWhite),
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
                          style: const TextStyle(color: textWhite),
                          decoration: const InputDecoration(
                            labelText: 'First Name',
                            labelStyle: TextStyle(color: textGray),
                            enabledBorder: OutlineInputBorder(
                              borderSide: BorderSide(color: borderCard),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderSide: BorderSide(color: brandGreen),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: lastNameController,
                          style: const TextStyle(color: textWhite),
                          decoration: const InputDecoration(
                            labelText: 'Last Name',
                            labelStyle: TextStyle(color: textGray),
                            enabledBorder: OutlineInputBorder(
                              borderSide: BorderSide(color: borderCard),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderSide: BorderSide(color: brandGreen),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: emailController,
                    style: const TextStyle(color: textWhite),
                    decoration: const InputDecoration(
                      labelText: 'Email Address',
                      labelStyle: TextStyle(color: textGray),
                      enabledBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: borderCard),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: brandGreen),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: phoneController,
                    style: const TextStyle(color: textWhite),
                    decoration: const InputDecoration(
                      labelText: 'Phone Number',
                      labelStyle: TextStyle(color: textGray),
                      enabledBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: borderCard),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: brandGreen),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: brandGreen,
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
                                  () => saveError =
                                      'First and last names are required.',
                                );
                                return;
                              }
                              updateDialog(() {
                                saving = true;
                                saveError = null;
                              });
                              try {
                                final response = await ref
                                    .read(dioProvider)
                                    .patch(
                                      '/users/${user.id}',
                                      data: {
                                        'firstName': firstName,
                                        'lastName': lastName,
                                        if (emailController.text.trim() !=
                                            (user.email ?? ''))
                                          'email': emailController.text.trim(),
                                        if (phoneController.text.trim() !=
                                            (user.phone ?? ''))
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
                                    content: Text(
                                      'Personal information updated successfully.',
                                    ),
                                    backgroundColor: brandGreen,
                                  ),
                                );
                              } catch (error) {
                                if (!dialogContext.mounted) return;
                                var message =
                                    'Personal information could not be saved. Please retry.';
                                if (error is DioException &&
                                    error.response?.data is Map) {
                                  final serverError =
                                      error.response?.data['error'];
                                  if (serverError is Map &&
                                      serverError['message'] is String) {
                                    message = serverError['message'] as String;
                                  }
                                }
                                updateDialog(() => saveError = message);
                              } finally {
                                if (dialogContext.mounted) {
                                  updateDialog(() => saving = false);
                                }
                              }
                            },
                      child: const Text(
                        'Save Details',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  if (saving) const LinearProgressIndicator(),
                  if (saveError != null)
                    Text(saveError!, style: const TextStyle(color: serviceRed)),
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

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Text(
          'Profile & Settings',
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

          // User Information Section
          Material(
            color: cardBg,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: const BorderSide(color: borderCard),
            ),
            child: Column(
              children: [
                _buildListTile(
                  Icons.person_outline_rounded,
                  'Personal Information',
                  onTap: () => _showPersonalInfoModal(context, user, ref),
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
                  onTap: () => context.push('/wallet'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // User Settings Section
          Material(
            color: cardBg,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: const BorderSide(color: borderCard),
            ),
            child: Column(
              children: [
                _buildListTile(
                  Icons.security_rounded,
                  'Privacy Settings',
                  onTap: () async {
                    try {
                      if (await openAppSettings()) return;
                    } catch (_) {}
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Open your device settings to manage INFURNUS permissions.',
                          ),
                        ),
                      );
                    }
                  },
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

          // Account Actions Section
          Material(
            color: cardBg,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: const BorderSide(color: borderCard),
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
