import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../../core/network/dio_client.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../../../auth/domain/entities/user.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  static const Color mainBg = Color(0xFFF8FAFC);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE2E8F0);
  static const Color textBlack = Color(0xFF0F172A);
  static const Color textGray = Color(0xFF64748B);
  static const Color brandGreen = Color(0xFF10B981);
  static const Color darkGreen = Color(0xFF065F46);
  static const Color headerDark = Color(0xFF032213);
  static const Color serviceRed = Color(0xFFEF4444);

  bool _isEditingPersonal = false;
  bool _isSaving = false;
  String? _saveMessage;
  String? _saveError;

  late TextEditingController _firstNameController;
  late TextEditingController _lastNameController;
  late TextEditingController _emailController;
  late TextEditingController _phoneController;

  @override
  void initState() {
    super.initState();
    _firstNameController = TextEditingController();
    _lastNameController = TextEditingController();
    _emailController = TextEditingController();
    _phoneController = TextEditingController();
  }

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _populateControllers(User? user) {
    if (user != null && !_isEditingPersonal) {
      _firstNameController.text = user.firstName;
      _lastNameController.text = user.lastName;
      _emailController.text = user.email ?? '';
      _phoneController.text = user.phone ?? '';
    }
  }

  Future<void> _saveDetails(User? user) async {
    if (user == null || _isSaving) return;

    final firstName = _firstNameController.text.trim();
    final lastName = _lastNameController.text.trim();
    final email = _emailController.text.trim();
    final phone = _phoneController.text.trim();

    // 1. Validation
    if (firstName.isEmpty) {
      setState(() {
        _saveError = 'Please enter your first name.';
        _saveMessage = null;
      });
      return;
    }

    if (email.isNotEmpty) {
      final emailRegex =
          RegExp(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');
      if (!emailRegex.hasMatch(email)) {
        setState(() {
          _saveError = 'Please enter a valid email address.';
          _saveMessage = null;
        });
        return;
      }
    }

    if (phone.isNotEmpty) {
      final cleanPhone = phone.replaceAll(RegExp(r'[\s\-]'), '');
      final phoneRegex = RegExp(r'^\+?[1-9]\d{7,14}$');
      if (!phoneRegex.hasMatch(cleanPhone)) {
        setState(() {
          _saveError =
              'Please enter a valid mobile number (e.g. +919876543210).';
          _saveMessage = null;
        });
        return;
      }
    }

    setState(() {
      _isSaving = true;
      _saveError = null;
      _saveMessage = null;
    });

    try {
      final isUuid = RegExp(
        r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
      ).hasMatch(user.id);

      User updatedUser = User(
        id: user.id,
        firstName: firstName,
        lastName: lastName,
        email: email.isNotEmpty ? email : user.email,
        phone: phone.isNotEmpty ? phone : user.phone,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: DateTime.now(),
      );

      if (isUuid) {
        final dio = ref.read(dioProvider);
        final response = await dio.patch(
          '/users/${user.id}',
          data: {
            'firstName': firstName,
            if (lastName.isNotEmpty) 'lastName': lastName,
            if (email.isNotEmpty) 'email': email,
            if (phone.isNotEmpty) 'phone': phone,
          },
        );
        final dynamic raw = response.data;
        if (raw is Map && raw['data'] is Map) {
          final data = raw['data'] as Map<String, dynamic>;
          updatedUser = User(
            id: data['id'] as String? ?? user.id,
            firstName: data['firstName'] as String? ?? firstName,
            lastName: data['lastName'] as String? ?? lastName,
            email: data['email'] as String? ?? email,
            phone: data['phone'] as String? ?? phone,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt:
                DateTime.tryParse(data['updatedAt'] as String? ?? '') ??
                DateTime.now(),
          );
        }
      }

      // Update provider immediately
      ref.read(userProvider.notifier).setUser(updatedUser);

      // Persist updated details to secure storage
      final storage = ref.read(secureStorageProvider);
      await storage.write(key: 'user_first_name', value: updatedUser.firstName);
      await storage.write(key: 'user_last_name', value: updatedUser.lastName);
      if (updatedUser.email != null) {
        await storage.write(key: 'user_email', value: updatedUser.email!);
      }
      if (updatedUser.phone != null) {
        await storage.write(key: 'user_phone', value: updatedUser.phone!);
      }

      if (mounted) {
        setState(() {
          _saveMessage = 'Personal information updated successfully.';
          _isEditingPersonal = false;
        });
      }
    } on Exception catch (e) {
      String msg = 'An error occurred while saving. Please try again.';
      try {
        final dynamic err = e;
        // ignore: avoid_dynamic_calls
        final dynamic resp = err.response;
        if (resp != null) {
          // ignore: avoid_dynamic_calls
          final int? statusCode = resp.statusCode as int?;
          if (statusCode == 401) {
            msg = 'Session expired. Please sign in again.';
          } else {
            // ignore: avoid_dynamic_calls
            final dynamic respData = resp.data;
            if (respData is Map) {
              final dynamic error = respData['error'];
              if (error is Map && error['message'] is String) {
                msg = error['message'] as String;
              } else if (respData['message'] is String) {
                msg = respData['message'] as String;
              }
            }
          }
        }
      } catch (_) {}
      if (mounted) {
        setState(() => _saveError = msg);
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  Future<void> _openPrivacySettings() async {
    final opened = await openAppSettings();
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Open your device settings to manage INFURNUS permissions.',
          ),
          duration: Duration(seconds: 4),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(userProvider);
    _populateControllers(user);

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        backgroundColor: headerDark,
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
            // 1. Header with Avatar & Name (NO phone number below name)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.only(
                top: 16,
                bottom: 26,
                left: 24,
                right: 24,
              ),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0xFF032213),
                    Color(0xFF063B23),
                    Color(0xFF0A4F30),
                  ],
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
                        width: 82,
                        height: 82,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: brandGreen, width: 2.5),
                          color: const Color(0xFF0F5132),
                        ),
                        child: const Center(
                          child: Icon(
                            Icons.person_rounded,
                            size: 46,
                            color: Colors.white,
                          ),
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
                    user != null && user.name.isNotEmpty
                        ? user.name
                        : 'INFURNUS Customer',
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: brandGreen.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: brandGreen.withValues(alpha: 0.4),
                      ),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.verified_rounded,
                          size: 13,
                          color: Color(0xFFA7F3D0),
                        ),
                        SizedBox(width: 5),
                        Text(
                          'Verified Customer Account',
                          style: TextStyle(
                            fontSize: 11,
                            color: Color(0xFFA7F3D0),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // 2. Body Cards
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Feedback message
                  if (_saveMessage != null)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 14),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFD1FAE5),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFA7F3D0)),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.check_circle_rounded,
                            color: Color(0xFF065F46),
                            size: 18,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              _saveMessage!,
                              style: const TextStyle(
                                color: Color(0xFF065F46),
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // CARD 1: Personal Information Card
                  _buildSectionHeader('Personal Information'),
                  const SizedBox(height: 8),
                  _buildPersonalInformationCard(user),
                  const SizedBox(height: 20),

                  // CARD 2: Activity & Services
                  _buildSectionHeader('Activity & Payments'),
                  const SizedBox(height: 8),
                  _buildSectionCard([
                    _buildTile(
                      Icons.receipt_long_rounded,
                      'Booking History',
                      () => context.push('/booking-history'),
                      subtitle: 'Review past trips & delivery orders',
                    ),
                    _buildTile(
                      Icons.account_balance_wallet_rounded,
                      'Wallet & Pay',
                      () => context.push('/wallet'),
                      subtitle: 'Balance, top-ups & recent payments',
                      showDivider: false,
                    ),
                  ]),
                  const SizedBox(height: 20),

                  // CARD 3: Preferences & Support
                  _buildSectionHeader('Preferences & Security'),
                  const SizedBox(height: 8),
                  _buildSectionCard([
                    _buildTile(
                      Icons.notifications_outlined,
                      'Notifications',
                      () {},
                      subtitle: 'Trip alerts and service updates',
                    ),
                    _buildTile(
                      Icons.shield_outlined,
                      'Privacy & App Permissions',
                      _openPrivacySettings,
                      subtitle: 'Location, camera & storage access',
                    ),
                    _buildTile(
                      Icons.support_agent_rounded,
                      'Help & Support',
                      () => context.push('/support'),
                      subtitle: '24/7 dedicated customer assistance',
                      showDivider: false,
                    ),
                  ]),
                  const SizedBox(height: 20),

                  // CARD 4: Legal & Policies
                  _buildSectionHeader('Legal & Compliance'),
                  const SizedBox(height: 8),
                  _buildSectionCard([
                    _buildTile(
                      Icons.policy_outlined,
                      'Privacy Policy',
                      () => context.push('/legal/privacy'),
                      subtitle: 'Data handling & DPDP Act compliance',
                    ),
                    _buildTile(
                      Icons.gavel_rounded,
                      'Terms & Conditions',
                      () => context.push('/legal/terms'),
                      subtitle: 'Customer agreement & service terms',
                      showDivider: false,
                    ),
                  ]),
                  const SizedBox(height: 20),

                  // CARD 5: Account Actions
                  _buildSectionHeader('Account Actions'),
                  const SizedBox(height: 8),
                  _buildSectionCard([
                    _buildTile(
                      Icons.delete_outline_rounded,
                      'Delete Account',
                      () => context.push('/delete-account'),
                      subtitle: 'Permanently remove your account & data',
                      isDestructive: true,
                    ),
                    _buildTile(
                      Icons.logout_rounded,
                      'Logout',
                      _showLogoutDialog,
                      subtitle: 'Sign out of your active session',
                      isDestructive: true,
                      showDivider: false,
                    ),
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

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.bold,
          color: textGray,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  Widget _buildPersonalInformationCard(User? user) {
    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCard),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.badge_outlined, size: 20, color: darkGreen),
                    SizedBox(width: 8),
                    Text(
                      'Account Details',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: textBlack,
                      ),
                    ),
                  ],
                ),
                TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _isEditingPersonal = !_isEditingPersonal;
                      _saveError = null;
                      _saveMessage = null;
                    });
                  },
                  icon: Icon(
                    _isEditingPersonal
                        ? Icons.close_rounded
                        : Icons.edit_outlined,
                    size: 16,
                    color: darkGreen,
                  ),
                  label: Text(
                    _isEditingPersonal ? 'Cancel' : 'Edit',
                    style: const TextStyle(
                      color: darkGreen,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1, color: borderCard),
            const SizedBox(height: 14),

            if (!_isEditingPersonal) ...[
              // Read-only Details View
              _buildInfoRow(
                Icons.person_outline_rounded,
                'First Name',
                user?.firstName.isNotEmpty == true
                    ? user!.firstName
                    : 'Not provided',
              ),
              const SizedBox(height: 12),
              _buildInfoRow(
                Icons.person_outline_rounded,
                'Last Name',
                user != null && user.lastName.isNotEmpty
                    ? user.lastName
                    : 'Not provided',
              ),
              const SizedBox(height: 12),
              _buildInfoRow(
                Icons.phone_iphone_rounded,
                'Mobile Number',
                user?.phone?.isNotEmpty == true ? user!.phone! : 'Not linked',
              ),
              const SizedBox(height: 12),
              _buildInfoRow(
                Icons.email_outlined,
                'Email Address',
                user?.email?.isNotEmpty == true ? user!.email! : 'Not linked',
              ),
            ] else ...[
              // Editable Form
              if (_saveError != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _saveError!,
                    style: const TextStyle(color: serviceRed, fontSize: 12),
                  ),
                ),
              _buildFormField(
                label: 'First Name',
                controller: _firstNameController,
                icon: Icons.person_outline,
              ),
              const SizedBox(height: 12),
              _buildFormField(
                label: 'Last Name',
                controller: _lastNameController,
                icon: Icons.person_outline,
              ),
              const SizedBox(height: 12),
              _buildFormField(
                label: 'Mobile Number',
                controller: _phoneController,
                icon: Icons.phone_iphone,
                keyboardType: TextInputType.phone,
              ),
              const SizedBox(height: 12),
              _buildFormField(
                label: 'Email Address',
                controller: _emailController,
                icon: Icons.email_outlined,
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: brandGreen,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    elevation: 0,
                  ),
                  onPressed: _isSaving ? null : () => _saveDetails(user),
                  child: _isSaving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          'Save Information',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, size: 18, color: textGray),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 11,
                  color: textGray,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: textBlack,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFormField({
    required String label,
    required TextEditingController controller,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, size: 18, color: textGray),
        labelStyle: const TextStyle(color: textGray, fontSize: 13),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 12,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borderCard),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borderCard),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: brandGreen, width: 1.5),
        ),
        filled: true,
        fillColor: mainBg,
      ),
      style: const TextStyle(fontSize: 14, color: textBlack),
    );
  }

  Widget _buildSectionCard(List<Widget> children) {
    return Material(
      color: cardBg,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: borderCard),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.02),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(children: children),
      ),
    );
  }

  Widget _buildTile(
    IconData icon,
    String title,
    VoidCallback onTap, {
    String? subtitle,
    bool isDestructive = false,
    bool showDivider = true,
  }) {
    final color = isDestructive ? serviceRed : textBlack;
    final iconColor = isDestructive ? serviceRed : darkGreen;

    return Column(
      children: [
        ListTile(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 4,
          ),
          leading: Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: isDestructive
                  ? serviceRed.withValues(alpha: 0.08)
                  : const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: iconColor, size: 19),
          ),
          title: Text(
            title,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          subtitle: subtitle != null
              ? Text(
                  subtitle,
                  style: const TextStyle(fontSize: 11, color: textGray),
                )
              : null,
          trailing: Icon(
            Icons.chevron_right_rounded,
            size: 20,
            color: isDestructive ? serviceRed : textGray,
          ),
          onTap: onTap,
        ),
        if (showDivider)
          const Divider(
            height: 1,
            indent: 56,
            endIndent: 16,
            color: borderCard,
          ),
      ],
    );
  }

  void _showLogoutDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Logout',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        content: const Text(
          'Are you sure you want to log out of your INFURNUS account?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel', style: TextStyle(color: textGray)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: serviceRed,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            onPressed: () async {
              Navigator.pop(context);
              await ref.read(authProvider.notifier).logout();
              if (!context.mounted) return;
              context.go('/login');
            },
            child: const Text('Logout'),
          ),
        ],
      ),
    );
  }
}
