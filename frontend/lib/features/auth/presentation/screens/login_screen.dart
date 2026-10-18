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
  final _passwordController = TextEditingController();
  bool _isEmailLogin = false;
  bool _isPasswordVisible = false;
  bool _rememberMe = true;

  @override
  void dispose() {
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _showForgotPasswordDialog() {
    context.push(
      '/forgot-password',
      extra: _isEmailLogin ? _emailController.text.trim() : '',
    );
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
      body: Stack(
        children: [
          // Top Hero Background (Dark Green Gradient + Logo)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: MediaQuery.of(context).size.height * 0.42,
            child: Container(
              decoration: const BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(0, -0.2),
                  radius: 0.9,
                  colors: [
                    Color(0xFF092212),
                    Color(0xFF000000),
                  ],
                ),
              ),
              child: SafeArea(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 90,
                      height: 90,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.emeraldNeon.withValues(alpha: 0.35),
                            blurRadius: 36,
                            spreadRadius: 4,
                          ),
                        ],
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(20),
                        child: Image.asset(
                          'assets/images/infurnus_logo.png',
                          fit: BoxFit.contain,
                          errorBuilder: (_, __, ___) => const Icon(
                            Icons.flash_on,
                            color: AppColors.emeraldNeon,
                            size: 54,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'INFURNUS',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 3,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
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

          // Bottom White Sheet Card Container
          Positioned.fill(
            top: MediaQuery.of(context).size.height * 0.36,
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(28),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black26,
                    blurRadius: 20,
                    offset: Offset(0, -5),
                  ),
                ],
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Log in or sign up',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 18),

                    // Phone / Email Switcher
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: () => setState(() => _isEmailLogin = !_isEmailLogin),
                          style: TextButton.styleFrom(
                            padding: EdgeInsets.zero,
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: Text(
                            _isEmailLogin ? 'Use Phone Number' : 'Use Email Address',
                            style: const TextStyle(
                              color: AppColors.primaryGreen,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    if (!_isEmailLogin)
                      // Phone Number Input
                      Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFFF3F4F6),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
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
                            const Icon(Icons.arrow_drop_down, color: Colors.grey),
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
                          color: const Color(0xFFF3F4F6),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
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

                    const SizedBox(height: 12),

                    // Optional Password Input
                    Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      child: TextField(
                        controller: _passwordController,
                        obscureText: !_isPasswordVisible,
                        decoration: InputDecoration(
                          hintText: 'Password (Optional for OTP)',
                          prefixIcon: const Icon(Icons.lock_outline, color: Colors.grey),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _isPasswordVisible ? Icons.visibility : Icons.visibility_off,
                              color: Colors.grey,
                            ),
                            onPressed: () => setState(() => _isPasswordVisible = !_isPasswordVisible),
                          ),
                          border: InputBorder.none,
                          hintStyle: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
                        ),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF111827),
                        ),
                      ),
                    ),

                    const SizedBox(height: 8),

                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Checkbox(
                              value: _rememberMe,
                              activeColor: AppColors.primaryGreen,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(4),
                              ),
                              onChanged: (val) => setState(() => _rememberMe = val ?? true),
                            ),
                            const Text(
                              'Remember my login',
                              style: TextStyle(
                                fontSize: 13,
                                color: Color(0xFF4B5563),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                        TextButton(
                          onPressed: _showForgotPasswordDialog,
                          child: const Text(
                            'Forgot?',
                            style: TextStyle(
                              color: AppColors.primaryGreen,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 16),

                    // Primary Black Continue Button
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF111827),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                          elevation: 0,
                        ),
                        onPressed: authState.status == AuthStatus.loading
                            ? null
                            : () {
                                if (_isEmailLogin) {
                                  if (_emailController.text.isNotEmpty) {
                                    final request = LoginRequest(
                                      email: _emailController.text.trim(),
                                      password: _passwordController.text,
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
                                      password: _passwordController.text,
                                    );
                                    ref.read(authProvider.notifier).login(request, 'phone');
                                  }
                                }
                              },
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
                                      fontSize: 16,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  SizedBox(width: 8),
                                  Icon(Icons.arrow_forward_rounded, size: 20),
                                ],
                              ),
                      ),
                    ),

                    const SizedBox(height: 20),

                    // Divider Row
                    const Row(
                      children: [
                        Expanded(child: Divider(color: Color(0xFFE5E7EB))),
                        Padding(
                          padding: EdgeInsets.symmetric(horizontal: 16),
                          child: Text(
                            'or',
                            style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
                          ),
                        ),
                        Expanded(child: Divider(color: Color(0xFFE5E7EB))),
                      ],
                    ),

                    const SizedBox(height: 18),

                    // Google Sign-In Button
                    Center(
                      child: GoogleSignInButton(
                        enabled: authState.status != AuthStatus.loading,
                        onIdToken: ref.read(authProvider.notifier).signInWithGoogle,
                      ),
                    ),

                    const SizedBox(height: 18),

                    // Create Customer Account Link
                    Center(
                      child: GestureDetector(
                        onTap: () => context.push('/signup'),
                        child: const Text(
                          'Create a customer account',
                          style: TextStyle(
                            color: AppColors.primaryGreen,
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
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

                    const SizedBox(height: 24),

                    // Fine Print Disclaimer
                    Center(
                      child: Text(
                        'By continuing, you agree to our Terms of Service,\nPrivacy Policy & Content Policy',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 11,
                          color: Color(0xFF9CA3AF),
                          height: 1.4,
                        ),
                      ),
                    ),
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
