import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../../core/network/dio_client.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../../../auth/domain/entities/user.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  static const Color mainBg = Color(0xFFF9FAFB);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE5E7EB);
  static const Color textBlack = Color(0xFF111827);
  static const Color textGray = Color(0xFF6B7280);
  static const Color brandGreen = Color(0xFF16A34A);
  static const Color serviceRed = Color(0xFFDC2626);

  bool _showPersonalInfo = false;
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
    if (user != null && !_showPersonalInfo) {
      _firstNameController.text = user.firstName;
      _lastNameController.text = user.lastName ?? '';
      _emailController.text = user.email ?? '';
      _phoneController.text = user.phone ?? '';
    }
  }

  Future<void> _saveDetails(User? user) async {
    if (user == null) return;
    setState(() {
      _isSaving = true;
      _saveError = null;
      _saveMessage = null;
    });
    try {
      final dio = ref.read(dioProvider);
      final response = await dio.patch('/users/${user.id}', data: {
        'firstName': _firstNameController.text.trim(),
        if (_lastNameController.text.trim().isNotEmpty)
          'lastName': _lastNameController.text.trim(),
        if (_emailController.text.trim().isNotEmpty)
          'email': _emailController.text.trim(),
        if (_phoneController.text.trim().isNotEmpty)
          'phone': _phoneController.text.trim(),
      });
      final data = (response.data as Map<String, dynamic>)['data']
          as Map<String, dynamic>;
      ref.read(userProvider.notifier).setUser(User(
            id: data['id'] as String? ?? user.id,
            firstName: data['firstName'] as String? ?? user.firstName,
            lastName: (data['lastName'] as String?) ?? '',
            email: data['email'] as String?,
            phone: data['phone'] as String?,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: DateTime.tryParse(data['updatedAt'] as String? ?? '') ??
                user.updatedAt,
          ));
      setState(() {
        _saveMessage = 'Personal information updated successfully.';
        _showPersonalInfo = false;
      });
    } catch (e) {
      String msg = 'An error occurred. Please try again.';
      try {
        final dynamic err = e;
        // ignore: avoid_dynamic_calls
        final dynamic resp = err.response;
        if (resp != null) {
          final dynamic respData = resp.data;
          if (respData is Map) {
            final dynamic error = respData['error'];
            if (error is Map && error['message'] is String) {
              msg = error['message'] as String;
            }
          }
        }
      } catch (_) {}
      setState(() => _saveError = msg);
    } finally {
      setState(() => _isSaving = false);
    }
  }

  Future<void> _openPrivacySettings() async {
    final opened = await openAppSettings();
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'Open your device settings to manage INFURNUS permissions.'),
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
              padding: const EdgeInsets.only(
                  top: 16, bottom: 28, left: 24, right: 24),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0xFF032213),
                    Color(0xFF063B23),
                    Color(0xFF0A4F30)
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
                        width: 84,
                        height: 84,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                              color: const Color(0xFF16A34A), width: 2.5),
                          color: const Color(0xFF0F5132),
                        ),
                        child: const Center(
                          child: Icon(Icons.person_rounded,
                              size: 48, color: Colors.white),
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
                    user != null
                        ? '${user.firstName} ${user.lastName ?? ''}'.trim()
                        : 'Test Customer',
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
              padding:
                  const EdgeInsets.symmetric(horizontal: 16.0, vertical: 16.0),
              child: Column(
                children: [
                  // Save/Error feedback
                  if (_saveMessage != null)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFD1FAE5),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _saveMessage!,
                        style: const TextStyle(
                            color: Color(0xFF065F46), fontSize: 13),
                      ),
                    ),

                  // Group 1: Personal, History, Wallet, Payment Methods
                  _buildSectionCard([
                    _buildTile(
                      Icons.person_outline_rounded,
                      'Personal Information',
                      () {
                        setState(() {
                          _showPersonalInfo = !_showPersonalInfo;
                          _saveError = null;
                          _saveMessage = null;
                          if (_showPersonalInfo) {
                            _firstNameController.text =
                                user?.firstName ?? '';
                            _lastNameController.text =
                                user?.lastName ?? '';
                            _emailController.text = user?.email ?? '';
                            _phoneController.text = user?.phone ?? '';
                          }
                        });
                      },
                    ),
                    if (_showPersonalInfo) _buildPersonalInfoForm(user),
                    _buildTile(
                      Icons.history_rounded,
                      'Ride History',
                      () => context.push('/booking-history'),
                    ),
                    _buildTile(
                      Icons.account_balance_wallet_outlined,
                      'Wallet & Pay',
                      () => context.push('/wallet'),
                    ),
                    _buildTile(
                      Icons.payment_rounded,
                      'Payment Methods',
                      () => context.push('/wallet'),
                      showDivider: false,
                    ),
                  ]),
                  const SizedBox(height: 14),

                  // Group 2: Notifications, Privacy, Help, Terms
                  _buildSectionCard([
                    _buildTile(
                        Icons.notifications_outlined, 'Notifications', () {}),
                    _buildTile(
                      Icons.shield_outlined,
                      'Privacy Settings',
                      _openPrivacySettings,
                    ),
                    _buildTile(
                      Icons.help_outline_rounded,
                      'Help & Support',
                      () => context.push('/support'),
                    ),
                    _buildTile(
                      Icons.info_outline_rounded,
                      'Privacy Policy',
                      () => context.push('/legal/privacy'),
                    ),
                    _buildTile(
                      Icons.description_outlined,
                      'Terms & Conditions',
                      () => context.push('/legal/terms'),
                      showDivider: false,
                    ),
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

  Widget _buildPersonalInfoForm(User? user) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_saveError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _saveError!,
                style: const TextStyle(color: serviceRed, fontSize: 13),
              ),
            ),
          _buildFormField(
            label: 'First Name',
            controller: _firstNameController,
          ),
          const SizedBox(height: 10),
          _buildFormField(
            label: 'Last Name',
            controller: _lastNameController,
          ),
          const SizedBox(height: 10),
          _buildFormField(
            label: 'Email',
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 46,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: brandGreen,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
                elevation: 0,
              ),
              onPressed: _isSaving ? null : () => _saveDetails(user),
              child: _isSaving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text(
                      'Save Details',
                      style: TextStyle(
                          fontSize: 15, fontWeight: FontWeight.bold),
                    ),
            ),
          ),
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Widget _buildFormField({
    required String label,
    required TextEditingController controller,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: textGray, fontSize: 13),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
          borderSide: const BorderSide(color: brandGreen),
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
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: Column(children: children),
        ),
      ),
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
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
          leading: Icon(icon,
              color: isDestructive ? serviceRed : textBlack, size: 20),
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
          const Divider(
              height: 1,
              thickness: 1,
              color: borderCard,
              indent: 54,
              endIndent: 16),
      ],
    );
  }
}
