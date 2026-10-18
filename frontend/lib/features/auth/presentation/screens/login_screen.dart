import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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
  bool _rememberMe = true;

  @override
  void dispose() {
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
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
      body: Stack(
        children: [
          // 1. Dark Neon Cityscape Hero Background Header
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: MediaQuery.of(context).size.height * 0.46,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      colors: [Color(0xFF032B13), Color(0xFF001105), Color(0xFF000000)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                ),
                // Optional subtle glowing city vibe
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: Container(
                    height: 120,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Colors.transparent, Colors.black.withValues(alpha: 0.8)],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                  ),
                ),
                Positioned(
                  top: 50,
                  left: 16,
                  child: IconButton(
                    icon: const Icon(Icons.arrow_back, color: Colors.white, size: 24),
                    onPressed: () => context.pop(),
                  ),
                ),
                Positioned(
                  top: 54,
                  right: 16,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF16A34A),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Text(
                      '64',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ),
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const SizedBox(height: 20),
                    Image.asset(
                      'assets/images/infurnus_3d_logo.png',
                      height: 100,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const Icon(
                        Icons.location_on_rounded,
                        color: Color(0xFF10B981),
                        size: 64,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Move. Haul. Rise.',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: Color(0xFF10B981),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // 2. Bottom Rounded White Card Sheet
          Positioned.fill(
            top: MediaQuery.of(context).size.height * 0.42,
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
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
                    const SizedBox(height: 24),

                    // Phone or Email Input
                    if (!_isEmailLogin)
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFD1D5DB)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        child: Row(
                          children: [
                            Row(
                              children: [
                                const Text('🇮🇳', style: TextStyle(fontSize: 20)),
                                const SizedBox(width: 8),
                                const Text(
                                  '+91',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.bold,
                                    color: Color(0xFF111827),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                const Icon(Icons.keyboard_arrow_down_rounded, color: Colors.grey, size: 20),
                                const SizedBox(width: 8),
                                Container(
                                  height: 24,
                                  width: 1,
                                  color: const Color(0xFFE5E7EB),
                                ),
                              ],
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextField(
                                controller: _phoneController,
                                keyboardType: TextInputType.phone,
                                decoration: const InputDecoration(
                                  hintText: 'Enter Phone Number',
                                  border: InputBorder.none,
                                  hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
                                ),
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
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
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFD1D5DB)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        child: TextField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            hintText: 'Enter Email Address',
                            prefixIcon: Icon(Icons.email_outlined, color: Colors.grey, size: 20),
                            border: InputBorder.none,
                            hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
                          ),
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF111827),
                          ),
                        ),
                      ),

                    const SizedBox(height: 12),

                    // Password Input (for password login)
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFD1D5DB)),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      child: TextField(
                        controller: _passwordController,
                        obscureText: true,
                        decoration: const InputDecoration(
                          hintText: 'Password',
                          prefixIcon: Icon(Icons.lock_outline_rounded, color: Colors.grey, size: 20),
                          border: InputBorder.none,
                          hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
                        ),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF111827),
                        ),
                      ),
                    ),

                    const SizedBox(height: 12),

                    // Checkbox & Use Email Row
                    Row(
                      children: [
                        SizedBox(
                          width: 24,
                          height: 24,
                          child: Checkbox(
                            value: _rememberMe,
                            activeColor: const Color(0xFF10B981),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                            onChanged: (val) => setState(() => _rememberMe = val ?? true),
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Expanded(
                          child: Text(
                            'Remember my login for faster sign-in',
                            style: TextStyle(fontSize: 12, color: Color(0xFF4B5563), fontWeight: FontWeight.w500),
                          ),
                        ),
                        GestureDetector(
                          onTap: () => setState(() => _isEmailLogin = !_isEmailLogin),
                          child: Text(
                            _isEmailLogin ? 'Use Phone' : 'Use Email',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF10B981),
                            ),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 24),

                    // Continue Button (Black with green border glow like reference)
                    Container(
                      width: double.infinity,
                      height: 52,
                      decoration: BoxDecoration(
                        color: Colors.black,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFF10B981), width: 1.5),
                      ),
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.transparent,
                          shadowColor: Colors.transparent,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        onPressed: authState.status == AuthStatus.loading ? null : _handleContinue,
                        child: authState.status == AuthStatus.loading
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(
                                    'Continue',
                                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                                  ),
                                  SizedBox(width: 8),
                                  Icon(Icons.arrow_forward_rounded, size: 18, color: Colors.white),
                                ],
                              ),
                      ),
                    ),

                    const SizedBox(height: 20),

                    // Divider OR
                    const Row(
                      children: [
                        Expanded(child: Divider(color: Color(0xFFE5E7EB))),
                        Padding(
                          padding: EdgeInsets.symmetric(horizontal: 16),
                          child: Text(
                            'OR',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF9CA3AF)),
                          ),
                        ),
                        Expanded(child: Divider(color: Color(0xFFE5E7EB))),
                      ],
                    ),

                    const SizedBox(height: 20),

                    // Google Sign-In Outlined Button
                    Center(
                      child: GoogleSignInButton(
                        enabled: authState.status != AuthStatus.loading,
                        onIdToken: ref.read(authProvider.notifier).signInWithGoogle,
                      ),
                    ),

                    if (authState.errorMessage != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Center(
                          child: Text(
                            authState.errorMessage!,
                            style: const TextStyle(color: Colors.red, fontSize: 13),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),

                    const SizedBox(height: 24),

                    // Bottom Link: Create a Customer account
                    Center(
                      child: GestureDetector(
                        onTap: () => context.push('/signup'),
                        child: const Text(
                          'Create a Customer account',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF111827),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _handleContinue() {
    if (ref.read(authProvider).status == AuthStatus.loading) return;

    if (_isEmailLogin) {
      if (_emailController.text.trim().isNotEmpty && _passwordController.text.isNotEmpty) {
        final request = LoginRequest(
          email: _emailController.text.trim(),
          password: _passwordController.text,
        );
        ref.read(authProvider.notifier).login(request, 'email');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your email and password.')),
        );
      }
    } else {
      if (_phoneController.text.trim().isNotEmpty && _passwordController.text.isNotEmpty) {
        final phone = _phoneController.text.trim().replaceAll(RegExp(r'[^\d+]'), '');
        final fullPhone = phone.startsWith('+') ? phone : '+91$phone';

        final request = LoginRequest(
          phone: fullPhone,
          password: _passwordController.text,
        );
        ref.read(authProvider.notifier).login(request, 'phone');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your phone number and password.')),
        );
      }
    }
  }
}
