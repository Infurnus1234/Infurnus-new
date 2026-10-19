import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../data/models/auth_models.dart';
import '../providers/auth_provider.dart';
import '../providers/user_provider.dart';
import '../widgets/google_sign_in_button.dart';

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
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          // Top Edge-to-Edge Hero Banner Image
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: MediaQuery.of(context).size.height * 0.46,
            child: SizedBox(
              width: double.infinity,
              height: double.infinity,
              child: Image.asset(
                'assets/images/vehicle_fleet_banner.png',
                fit: BoxFit.cover,
                alignment: Alignment.topCenter,
                errorBuilder: (_, __, ___) => Container(
                  color: const Color(0xFF092212),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: const [
                      Text(
                        'INFURNUS',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 3,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Move. Haul. Rise.',
                        style: TextStyle(
                          color: AppColors.emeraldNeon,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 2,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Bottom White Sheet Card Container
          Positioned.fill(
            top: MediaQuery.of(context).size.height * 0.40,
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(28),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black12,
                    blurRadius: 16,
                    offset: Offset(0, -4),
                  ),
                ],
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Center(
                      child: Text(
                        'Log in or sign up',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF111827),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),

                    if (!_isEmailLogin)
                      // Phone Number Input
                      Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFFF9FAFB),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        child: Row(
                          children: [
                            const Text('🇮🇳', style: TextStyle(fontSize: 20)),
                            const SizedBox(width: 8),
                            const Text(
                              '+91',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF111827),
                              ),
                            ),
                            const Icon(Icons.keyboard_arrow_down_rounded, color: Colors.grey),
                            Container(
                              height: 24,
                              width: 1,
                              color: const Color(0xFFD1D5DB),
                              margin: const EdgeInsets.symmetric(horizontal: 12),
                            ),
                            Expanded(
                              child: TextField(
                                controller: _phoneController,
                                keyboardType: TextInputType.phone,
                                decoration: const InputDecoration(
                                  hintText: 'Enter Phone Number',
                                  border: InputBorder.none,
                                  hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 15),
                                ),
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                  color: Color(0xFF111827),
                                ),
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      // Email Input
                      Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFFF9FAFB),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        child: TextField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            hintText: 'Enter Email Address',
                            prefixIcon: Icon(Icons.email_outlined, color: Colors.grey),
                            border: InputBorder.none,
                            hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 15),
                          ),
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF111827),
                          ),
                        ),
                      ),

                    const SizedBox(height: 14),

                    // Remember my login checkbox & Use Email link
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            SizedBox(
                              height: 24,
                              width: 24,
                              child: Checkbox(
                                value: _rememberMe,
                                activeColor: const Color(0xFF22C55E),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                onChanged: (val) => setState(() => _rememberMe = val ?? true),
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Text(
                              'Remember my login for faster sign-in',
                              style: TextStyle(
                                fontSize: 13,
                                color: Color(0xFF374151),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                        GestureDetector(
                          onTap: () => setState(() => _isEmailLogin = !_isEmailLogin),
                          child: Text(
                            _isEmailLogin ? 'Use Phone' : 'Use Email',
                            style: const TextStyle(
                              color: Color(0xFF22C55E),
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 18),

                    // Primary Black Continue Button with Glowing Green Border & Shadow
                    Container(
                      width: double.infinity,
                      height: 52,
                      decoration: BoxDecoration(
                        color: const Color(0xFF03170C),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF22C55E), width: 1.5),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF22C55E).withValues(alpha: 0.4),
                            blurRadius: 10,
                            spreadRadius: 1,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(14),
                          onTap: authState.status == AuthStatus.loading
                              ? null
                              : () {
                                  if (_isEmailLogin) {
                                    if (_emailController.text.isNotEmpty) {
                                      final request = LoginRequest(
                                        email: _emailController.text.trim(),
                                        password: '',
                                      );
                                      ref.read(authProvider.notifier).login(request, 'email');
                                    }
                                  } else {
                                    if (_phoneController.text.isNotEmpty) {
                                      final phone = _phoneController.text.trim().replaceAll(
                                        RegExp(r'[^\d+]'),
                                        '',
                                      );
                                      final fullPhone = phone.startsWith('+') ? phone : '+91$phone';

                                      final request = LoginRequest(
                                        phone: fullPhone,
                                        password: '',
                                      );
                                      ref.read(authProvider.notifier).login(request, 'phone');
                                    }
                                  }
                                },
                          child: Center(
                            child: authState.status == AuthStatus.loading
                                ? const SizedBox(
                                    width: 22,
                                    height: 22,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.5,
                                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                    ),
                                  )
                                : const Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        'Continue',
                                        style: TextStyle(
                                          color: Colors.white,
                                          fontSize: 16,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      SizedBox(width: 8),
                                      Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 20),
                                    ],
                                  ),
                          ),
                        ),
                      ),
                    ),

                    const SizedBox(height: 20),

                    // Divider Row with uppercase OR
                    const Row(
                      children: [
                        Expanded(child: Divider(color: Color(0xFFE5E7EB))),
                        Padding(
                          padding: EdgeInsets.symmetric(horizontal: 16),
                          child: Text(
                            'OR',
                            style: TextStyle(
                              color: Color(0xFF9CA3AF),
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1,
                            ),
                          ),
                        ),
                        Expanded(child: Divider(color: Color(0xFFE5E7EB))),
                      ],
                    ),

                    const SizedBox(height: 20),

                    // Google Sign-In Button
                    Center(
                      child: GoogleSignInButton(
                        enabled: authState.status != AuthStatus.loading,
                        onIdToken: ref.read(authProvider.notifier).signInWithGoogle,
                      ),
                    ),

                    const SizedBox(height: 20),

                    // Create Customer Account Link
                    Center(
                      child: GestureDetector(
                        onTap: () => context.push('/signup'),
                        child: RichText(
                          text: const TextSpan(
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                            children: [
                              TextSpan(
                                text: 'Create a ',
                                style: TextStyle(color: Color(0xFF111827)),
                              ),
                              TextSpan(
                                text: 'Customer',
                                style: TextStyle(color: Color(0xFF22C55E)),
                              ),
                              TextSpan(
                                text: ' account',
                                style: TextStyle(color: Color(0xFF111827)),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),

                    if (authState.errorMessage != null) ...[
                      const SizedBox(height: 14),
                      Center(
                        child: Text(
                          authState.errorMessage!,
                          style: const TextStyle(color: Colors.red, fontSize: 13),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],

                    const SizedBox(height: 16),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
