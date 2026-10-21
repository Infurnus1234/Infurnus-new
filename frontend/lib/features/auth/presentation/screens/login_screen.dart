import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
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

  static const _green = Color(0xFF00A859);

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
        physics: const ClampingScrollPhysics(),
        child: Column(
          children: [
            // ── TOP: Photo-realistic promotional hero image ──
            const AuthHeroBanner(),

            // ── BOTTOM: White rounded login panel ──
            Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x33000000),
                    blurRadius: 24,
                    offset: Offset(0, -6),
                  ),
                ],
              ),
              padding: const EdgeInsets.fromLTRB(22, 28, 22, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Heading ──
                  const Center(
                    child: Text(
                      'Log in or sign up',
                      style: TextStyle(
                        fontSize: 23,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF111827),
                        letterSpacing: -0.3,
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),

                  // ── Phone / Email Input ──
                  if (!_isEmailLogin) _buildPhoneInput() else _buildEmailInput(),

                  const SizedBox(height: 14),

                  // ── Checkbox row ──
                  Row(
                    children: [
                      SizedBox(
                        width: 22,
                        height: 22,
                        child: Checkbox(
                          value: _rememberMe,
                          activeColor: _green,
                          checkColor: Colors.white,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(5)),
                          side: const BorderSide(
                              color: Color(0xFF00A859), width: 2),
                          onChanged: (val) =>
                              setState(() => _rememberMe = val ?? true),
                        ),
                      ),
                      const SizedBox(width: 10),
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
                        onTap: () =>
                            setState(() => _isEmailLogin = !_isEmailLogin),
                        child: Text(
                          _isEmailLogin ? 'Use Phone' : 'Use Email',
                          style: const TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.bold,
                            color: _green,
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 22),

                  // ── Continue Button (glowing dark green) ──
                  _ContinueButton(
                    isLoading: authState.status == AuthStatus.loading,
                    onPressed: _handleContinue,
                  ),

                  const SizedBox(height: 20),

                  // ── OR divider ──
                  Row(
                    children: [
                      const Expanded(
                          child: Divider(
                              color: Color(0xFFD1D5DB), thickness: 1)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        child: Text(
                          'OR',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey.shade400,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 1.2,
                          ),
                        ),
                      ),
                      const Expanded(
                          child: Divider(
                              color: Color(0xFFD1D5DB), thickness: 1)),
                    ],
                  ),

                  const SizedBox(height: 20),

                  // ── Google Sign-In Button ──
                  _GoogleButton(
                    onPressed: () {
                      ref
                          .read(authProvider.notifier)
                          .signInWithGoogle('dummy-google-token');
                    },
                  ),

                  if (kDebugMode) ...[
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Color(0xFF16A34A), width: 1.5),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                        ),
                        onPressed: () {
                          ref.read(authProvider.notifier).devBypassLogin();
                        },
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.developer_mode_rounded, size: 18, color: Color(0xFF16A34A)),
                            SizedBox(width: 8),
                            Text(
                              'Dev Bypass (Open Dashboard)',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF16A34A),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],

                  if (authState.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
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

                  const SizedBox(height: 24),

                  // ── Create account link ──
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
                              style: TextStyle(color: _green),
                            ),
                            TextSpan(text: ' account'),
                          ],
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 20),

                  // ── Legal disclaimer ──
                  Center(
                    child: Text(
                      'By continuing, you agree to our Terms of Service,\nPrivacy Policy & Content Policy',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey.shade400,
                        height: 1.5,
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

  Widget _buildPhoneInput() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      child: Row(
        children: [
          const Text('🇮🇳', style: TextStyle(fontSize: 20)),
          const SizedBox(width: 6),
          const Text(
            '+91',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: Color(0xFF111827),
            ),
          ),
          const SizedBox(width: 4),
          const Icon(Icons.keyboard_arrow_down_rounded,
              color: Color(0xFF6B7280), size: 20),
          const SizedBox(width: 8),
          Container(width: 1, height: 22, color: const Color(0xFFE5E7EB)),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: Color(0xFF111827),
              ),
              decoration: const InputDecoration(
                hintText: 'Enter Phone Number',
                border: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 12),
                hintStyle: TextStyle(
                  color: Color(0xFF9CA3AF),
                  fontSize: 15,
                  fontWeight: FontWeight.normal,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailInput() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      child: TextField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: Color(0xFF111827),
        ),
        decoration: const InputDecoration(
          hintText: 'Enter Email Address',
          prefixIcon: Icon(Icons.email_outlined,
              color: Color(0xFF6B7280), size: 20),
          border: InputBorder.none,
          isDense: true,
          contentPadding: EdgeInsets.symmetric(vertical: 12),
          hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 15),
        ),
      ),
    );
  }

  void _handleContinue() {
    if (ref.read(authProvider).status == AuthStatus.loading) return;

    if (_isEmailLogin) {
      final email = _emailController.text.trim();
      if (email.isNotEmpty) {
        ref.read(authProvider.notifier).login(
              LoginRequest(email: email),
              'email',
            );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your email address.')),
        );
      }
    } else {
      final raw = _phoneController.text.trim();
      if (raw.isNotEmpty) {
        final clean = raw.replaceAll(RegExp(r'[^\d+]'), '');
        final fullPhone = clean.startsWith('+') ? clean : '+91$clean';
        ref.read(authProvider.notifier).login(
              LoginRequest(phone: fullPhone),
              'phone',
            );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your phone number.')),
        );
      }
    }
  }
}

class _ContinueButton extends StatelessWidget {
  final bool isLoading;
  final VoidCallback onPressed;

  const _ContinueButton({required this.isLoading, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 54,
      decoration: BoxDecoration(
        color: const Color(0xFF012010),
        borderRadius: BorderRadius.circular(27),
        border: Border.all(color: const Color(0xFF00E676), width: 1.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x6600E676),
            blurRadius: 18,
            spreadRadius: 2,
          ),
        ],
      ),
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(27)),
        ),
        onPressed: isLoading ? null : onPressed,
        child: isLoading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                    strokeWidth: 2.5, color: Colors.white),
              )
            : const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'Continue',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                      letterSpacing: 0.4,
                    ),
                  ),
                  SizedBox(width: 10),
                  Icon(Icons.arrow_forward_rounded,
                      size: 22, color: Colors.white),
                ],
              ),
      ),
    );
  }
}

class _GoogleButton extends StatelessWidget {
  final VoidCallback onPressed;
  const _GoogleButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 52,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          side: BorderSide.none,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(26)),
        ),
        onPressed: onPressed,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _GoogleGIcon(),
            const SizedBox(width: 10),
            const Text(
              'Sign in with Google',
              style: TextStyle(
                fontSize: 15.5,
                fontWeight: FontWeight.bold,
                color: Color(0xFF111827),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GoogleGIcon extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: const Color(0xFFE5E7EB), width: 1),
          ),
        ),
        Image.network(
          'https://www.google.com/favicon.ico',
          width: 18,
          height: 18,
          errorBuilder: (_, __, ___) => const Text(
            'G',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: Color(0xFF4285F4),
            ),
          ),
        ),
      ],
    );
  }
}
