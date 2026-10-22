import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/auth_models.dart';
import '../providers/auth_provider.dart';
import '../providers/user_provider.dart';
import '../widgets/auth_hero_banner.dart';
import '../widgets/google_sign_in_button.dart';

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();

  bool _isEmail = false;
  final String _selectedRole = 'customer';
  String? _validationError;

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _handleSignup() {
    setState(() => _validationError = null);

    final firstName = _firstNameController.text.trim();
    final lastName = _lastNameController.text.trim();

    if (firstName.isEmpty || lastName.isEmpty) {
      setState(
        () => _validationError = 'Please enter your first and last name.',
      );
      return;
    }

    if (_isEmail && _emailController.text.trim().isEmpty) {
      setState(() => _validationError = 'Please enter a valid email address.');
      return;
    }

    if (!_isEmail && _phoneController.text.trim().isEmpty) {
      setState(() => _validationError = 'Please enter a valid phone number.');
      return;
    }

    String? email;
    String? phone;

    if (_isEmail) {
      email = _emailController.text.trim();
    } else {
      final p = _phoneController.text.trim().replaceAll(RegExp(r'[^\d+]'), '');
      phone = p.startsWith('+') ? p : '+91$p';
    }

    final request = SignupRequest(
      firstName: firstName,
      lastName: lastName,
      email: email,
      phone: phone,
      role: _selectedRole,
    );

    ref.read(authProvider.notifier).signup(request);
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    ref.listen(authProvider, (previous, next) {
      if (next.status == AuthStatus.otpRequired && next.signupId != null) {
        context.push('/otp');
      } else if (next.status == AuthStatus.authenticated) {
        context.go(authHomeRoute(ref.read(userProvider)?.role));
      }
    });

    return Scaffold(
      backgroundColor: Colors.black,
      body: SingleChildScrollView(
        child: Column(
          children: [
            // 1. TOP HERO BRAND BANNER
            const AuthHeroBanner(),

            // 2. WHITE BOTTOM SIGNUP CARD
            Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black26,
                    blurRadius: 20,
                    offset: Offset(0, -5),
                  ),
                ],
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: 24.0,
                vertical: 28.0,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title: "Create a Customer Account"
                  Center(
                    child: RichText(
                      text: const TextSpan(
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF111827),
                        ),
                        children: [
                          TextSpan(text: 'Create a '),
                          TextSpan(
                            text: 'Customer',
                            style: TextStyle(color: Color(0xFF00A859)),
                          ),
                          TextSpan(text: ' Account'),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Center(
                    child: Text(
                      'Sign up to get started with INFURNUS',
                      style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
                    ),
                  ),
                  const SizedBox(height: 22),

                  // First Name & Last Name
                  Row(
                    children: [
                      Expanded(
                        child: _buildInputBox(
                          controller: _firstNameController,
                          hint: 'First Name',
                          icon: Icons.person_outline_rounded,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _buildInputBox(
                          controller: _lastNameController,
                          hint: 'Last Name',
                          icon: Icons.person_outline_rounded,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Phone or Email Input
                  if (!_isEmail)
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: const Color(0xFFD1D5DB),
                          width: 1.2,
                        ),
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 4,
                      ),
                      child: Row(
                        children: [
                          const Text('🇮🇳', style: TextStyle(fontSize: 18)),
                          const SizedBox(width: 8),
                          const Text(
                            '+91',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF111827),
                            ),
                          ),
                          const SizedBox(width: 4),
                          const Icon(
                            Icons.keyboard_arrow_down_rounded,
                            color: Color(0xFF6B7280),
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Container(
                            height: 24,
                            width: 1,
                            color: const Color(0xFFE5E7EB),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextField(
                              controller: _phoneController,
                              keyboardType: TextInputType.phone,
                              decoration: const InputDecoration(
                                hintText: 'Enter Phone Number',
                                border: InputBorder.none,
                                isDense: true,
                                hintStyle: TextStyle(
                                  color: Color(0xFF9CA3AF),
                                  fontSize: 15,
                                ),
                              ),
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF111827),
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    _buildInputBox(
                      controller: _emailController,
                      hint: 'Enter Email Address',
                      icon: Icons.email_outlined,
                      keyboardType: TextInputType.emailAddress,
                    ),

                  const SizedBox(height: 8),

                  // Toggle Use Email / Phone
                  Align(
                    alignment: Alignment.centerRight,
                    child: GestureDetector(
                      onTap: () => setState(() => _isEmail = !_isEmail),
                      child: Text(
                        _isEmail ? 'Use Phone' : 'Use Email',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF00A859),
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 20),

                  if (_validationError != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: Center(
                        child: Text(
                          _validationError!,
                          style: const TextStyle(
                            color: Colors.red,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),

                  // Sign Up Button
                  Container(
                    width: double.infinity,
                    height: 52,
                    decoration: BoxDecoration(
                      color: const Color(0xFF012010),
                      borderRadius: BorderRadius.circular(26),
                      border: Border.all(
                        color: const Color(0xFF00E676),
                        width: 1.2,
                      ),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x5500E676),
                          blurRadius: 12,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        shadowColor: Colors.transparent,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(26),
                        ),
                      ),
                      onPressed: authState.status == AuthStatus.loading
                          ? null
                          : _handleSignup,
                      child: authState.status == AuthStatus.loading
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  'Sign Up',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                SizedBox(width: 8),
                                Icon(
                                  Icons.arrow_forward_rounded,
                                  size: 20,
                                  color: Colors.white,
                                ),
                              ],
                            ),
                    ),
                  ),

                  const SizedBox(height: 20),

                  // Separator: "OR"
                  Row(
                    children: [
                      const Expanded(
                        child: Divider(color: Color(0xFFE5E7EB), thickness: 1),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        child: Text(
                          'OR',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey.shade500,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1.0,
                          ),
                        ),
                      ),
                      const Expanded(
                        child: Divider(color: Color(0xFFE5E7EB), thickness: 1),
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),

                  // Secondary Button: Google Sign In
                  Container(
                    width: double.infinity,
                    height: 50,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(25),
                      border: Border.all(
                        color: const Color(0xFFD1D5DB),
                        width: 1.2,
                      ),
                    ),
                    child: GoogleSignInButton(
                      style: OutlinedButton.styleFrom(
                        side: BorderSide.none,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(25),
                        ),
                      ),
                      enabled: authState.status != AuthStatus.loading,
                      onIdToken: ref
                          .read(authProvider.notifier)
                          .signInWithGoogle,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Image.network(
                            'https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg',
                            width: 20,
                            height: 20,
                            errorBuilder: (_, __, ___) => const Icon(
                              Icons.g_mobiledata_rounded,
                              size: 26,
                              color: Color(0xFF4285F4),
                            ),
                          ),
                          const SizedBox(width: 10),
                          const Text(
                            'Sign in with Google',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF111827),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  if (authState.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 14),
                      child: Center(
                        child: Text(
                          authState.errorMessage!,
                          style: const TextStyle(
                            color: Colors.red,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),

                  const SizedBox(height: 22),

                  // Link: "Already have an account? Log In"
                  Center(
                    child: GestureDetector(
                      onTap: () => context.push('/login'),
                      child: RichText(
                        text: const TextSpan(
                          style: TextStyle(
                            fontSize: 14,
                            color: Color(0xFF4B5563),
                          ),
                          children: [
                            TextSpan(text: 'Already have an account? '),
                            TextSpan(
                              text: 'Log In',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF00A859),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 20),

                  // Legal Disclaimer
                  Center(
                    child: Text(
                      'By continuing, you agree to our Terms of Service,\nPrivacy Policy & Content Policy',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey.shade500,
                        height: 1.4,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputBox({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    bool obscureText = false,
    Widget? suffixIcon,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: TextField(
        controller: controller,
        obscureText: obscureText,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          hintText: hint,
          prefixIcon: Icon(icon, color: const Color(0xFF6B7280), size: 20),
          suffixIcon: suffixIcon,
          border: InputBorder.none,
          isDense: true,
          hintStyle: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 15),
        ),
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: Color(0xFF111827),
        ),
      ),
    );
  }
}
