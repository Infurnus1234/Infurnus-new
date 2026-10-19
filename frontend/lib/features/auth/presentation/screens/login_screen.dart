import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/auth_models.dart';
import '../providers/auth_provider.dart';
import '../providers/user_provider.dart';
import '../widgets/auth_hero_banner.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();

  bool _isEmailLogin = false;
  bool _rememberMe = true;

  @override
  void dispose() {
    _phoneController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    ref.listen(authProvider, (previous, next) {
      if (next.status == AuthStatus.authenticated) {
        context.go(authHomeRoute(ref.read(userProvider)?.role));
      } else if (next.status == AuthStatus.otpRequired) {
        context.push('/otp');
      }
    });

    return Scaffold(
      backgroundColor: Colors.black,
      body: SingleChildScrollView(
        child: Column(
          children: [
            // 1. TOP HERO BRAND BANNER
            const AuthHeroBanner(),

            // 2. WHITE BOTTOM CARD ("Log in or sign up")
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
              padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 28.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title: "Log in or sign up"
                  const Center(
                    child: Text(
                      'Log in or sign up',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF111827),
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),

                  // Input Box: Phone or Email
                  if (!_isEmailLogin)
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
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
                                  fontWeight: FontWeight.normal,
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
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                      child: TextField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(
                          hintText: 'Enter Email Address',
                          prefixIcon: Icon(Icons.email_outlined, color: Color(0xFF6B7280), size: 20),
                          border: InputBorder.none,
                          isDense: true,
                          hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 15),
                        ),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF111827),
                        ),
                      ),
                    ),

                  const SizedBox(height: 14),

                  // Checkbox & Use Email/Phone link
                  Row(
                    children: [
                      SizedBox(
                        width: 22,
                        height: 22,
                        child: Checkbox(
                          value: _rememberMe,
                          activeColor: const Color(0xFF00A859),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                          onChanged: (val) => setState(() => _rememberMe = val ?? true),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text(
                          'Remember my login for faster sign-in',
                          style: TextStyle(
                            fontSize: 12.5,
                            color: Color(0xFF374151),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                      GestureDetector(
                        onTap: () => setState(() => _isEmailLogin = !_isEmailLogin),
                        child: Text(
                          _isEmailLogin ? 'Use Phone' : 'Use Email',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF00A859),
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 22),

                  // Primary Button: Dark Green Glowing "Continue ->"
                  Container(
                    width: double.infinity,
                    height: 52,
                    decoration: BoxDecoration(
                      color: const Color(0xFF012010),
                      borderRadius: BorderRadius.circular(26),
                      border: Border.all(color: const Color(0xFF00E676), width: 1.2),
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
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                      ),
                      onPressed: authState.status == AuthStatus.loading ? null : _handleContinue,
                      child: authState.status == AuthStatus.loading
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  'Continue',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                SizedBox(width: 8),
                                Icon(Icons.arrow_forward_rounded, size: 20, color: Colors.white),
                              ],
                            ),
                    ),
                  ),

                  const SizedBox(height: 20),

                  // Separator: "OR"
                  Row(
                    children: [
                      const Expanded(child: Divider(color: Color(0xFFE5E7EB), thickness: 1)),
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
                      const Expanded(child: Divider(color: Color(0xFFE5E7EB), thickness: 1)),
                    ],
                  ),

                  const SizedBox(height: 20),

                  // Secondary Button: "Sign in with Google"
                  Container(
                    width: double.infinity,
                    height: 50,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(25),
                      border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
                    ),
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        side: BorderSide.none,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(25)),
                      ),
                      onPressed: () {
                        ref.read(authProvider.notifier).signInWithGoogle('dummy-google-token');
                      },
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
                          style: const TextStyle(color: Colors.red, fontSize: 13, fontWeight: FontWeight.w500),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),

                  const SizedBox(height: 24),

                  // Link: "Create a Customer account"
                  Center(
                    child: GestureDetector(
                      onTap: () => context.push('/signup'),
                      child: RichText(
                        text: const TextSpan(
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF111827),
                          ),
                          children: [
                            TextSpan(text: 'Create a '),
                            TextSpan(
                              text: 'Customer',
                              style: TextStyle(color: Color(0xFF00A859)),
                            ),
                            TextSpan(text: ' account'),
                          ],
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 22),

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

  void _handleContinue() {
    if (ref.read(authProvider).status == AuthStatus.loading) return;

    if (_isEmailLogin) {
      if (_emailController.text.trim().isNotEmpty) {
        final request = LoginRequest(
          email: _emailController.text.trim(),
        );
        ref.read(authProvider.notifier).login(request, 'email');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your email address.')),
        );
      }
    } else {
      if (_phoneController.text.trim().isNotEmpty) {
        final phone = _phoneController.text.trim().replaceAll(RegExp(r'[^\d+]'), '');
        final fullPhone = phone.startsWith('+') ? phone : '+91$phone';

        final request = LoginRequest(
          phone: fullPhone,
        );
        ref.read(authProvider.notifier).login(request, 'phone');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your phone number.')),
        );
      }
    }
  }
}
