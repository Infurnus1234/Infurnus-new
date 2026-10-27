import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/auth_models.dart';
import '../providers/auth_provider.dart';
import '../providers/user_provider.dart';
import '../widgets/google_sign_in_button.dart';
import '../utils/phone_number.dart';
import '../widgets/auth_phone_field.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with SingleTickerProviderStateMixin {
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  bool _isEmailLogin = false;
  bool _rememberMe = true;

  late AnimationController _sheetController;
  late Animation<Offset> _sheetSlide;
  late Animation<double> _sheetFade;

  static const _green = Color(0xFF00A859);
  static const _neonGreen = Color(0xFF00E676);

  @override
  void initState() {
    super.initState();
    _sheetController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _sheetSlide = Tween<Offset>(begin: const Offset(0, 0.15), end: Offset.zero)
        .animate(
          CurvedAnimation(parent: _sheetController, curve: Curves.easeOutCubic),
        );
    _sheetFade = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _sheetController,
        curve: const Interval(0.1, 0.7, curve: Curves.easeOut),
      ),
    );
    _sheetController.forward();
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _emailController.dispose();
    _sheetController.dispose();
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

    final screenHeight = MediaQuery.of(context).size.height;
    final keyboardInset = MediaQuery.of(context).viewInsets.bottom;
    final isKeyboardOpen = keyboardInset > 80;

    final bannerHeight = isKeyboardOpen
        ? (screenHeight * 0.20).clamp(140.0, 200.0)
        : (screenHeight * 0.48).clamp(280.0, 480.0);

    return Scaffold(
      backgroundColor: Colors.black,
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          // ── TOP: Hero Banner with gradient overlay ──
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: bannerHeight,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(
                  'assets/images/login_hero_clean.jpg',
                  fit: BoxFit.cover,
                  alignment: Alignment.topCenter,
                  errorBuilder: (_, __, ___) => Image.asset(
                    'assets/images/login_hero_banner.jpg',
                    fit: BoxFit.cover,
                    alignment: Alignment.topCenter,
                    errorBuilder: (_, __, ___) => Container(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          colors: [Color(0xFF012B14), Color(0xFF001207)],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        ),
                      ),
                    ),
                  ),
                ),
                // Dark gradient overlay for better readability
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: bannerHeight * 0.4,
                  child: Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Colors.transparent, Colors.black],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                  ),
                ),
                // Back button
                Positioned(
                  top: MediaQuery.of(context).padding.top + 8,
                  left: 12,
                  child: Material(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(20),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(20),
                      onTap: () {
                        if (context.canPop()) {
                          context.pop();
                        } else {
                          context.go('/welcome');
                        }
                      },
                      child: const Padding(
                        padding: EdgeInsets.all(8),
                        child: Icon(
                          Icons.arrow_back_ios_new_rounded,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),

          // ── BOTTOM: White Sheet with Login Form ──
          Positioned(
            top: bannerHeight - 28,
            left: 0,
            right: 0,
            bottom: 0,
            child: SlideTransition(
              position: _sheetSlide,
              child: FadeTransition(
                opacity: _sheetFade,
                child: Container(
                  width: double.infinity,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(32),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Color(0x44000000),
                        blurRadius: 24,
                        offset: Offset(0, -6),
                      ),
                    ],
                  ),
                  child: SafeArea(
                    top: false,
                    child: SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Title
                          Column(
                            children: [
                              const Text(
                                'Welcome Back',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFF111827),
                                  letterSpacing: -0.5,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'Log in to continue your journey',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: Colors.grey.shade500,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),

                          const SizedBox(height: 28),

                          // Input label
                          Text(
                            _isEmailLogin ? 'Email Address' : 'Phone Number',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF374151),
                              letterSpacing: 0.3,
                            ),
                          ),
                          const SizedBox(height: 8),

                          // Phone or Email Input
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 300),
                            child: _isEmailLogin
                                ? _buildEmailInputField()
                                : _buildPhoneInputField(),
                          ),

                          const SizedBox(height: 14),

                          // Remember me + Use Email toggle
                          Wrap(
                            alignment: WrapAlignment.spaceBetween,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: 16,
                            runSpacing: 10,
                            children: [
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  SizedBox(
                                    width: 22,
                                    height: 22,
                                    child: Checkbox(
                                      value: _rememberMe,
                                      activeColor: _green,
                                      checkColor: Colors.white,
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(5),
                                      ),
                                      side: const BorderSide(
                                        color: _green,
                                        width: 2,
                                      ),
                                      onChanged: (val) {
                                        setState(
                                          () => _rememberMe = val ?? true,
                                        );
                                      },
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  const Text(
                                    'Remember me',
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      color: Color(0xFF374151),
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                              GestureDetector(
                                onTap: () {
                                  setState(
                                    () => _isEmailLogin = !_isEmailLogin,
                                  );
                                },
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    border: Border.all(
                                      color: _green.withValues(alpha: 0.3),
                                    ),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        _isEmailLogin
                                            ? Icons.phone_outlined
                                            : Icons.email_outlined,
                                        size: 14,
                                        color: _green,
                                      ),
                                      const SizedBox(width: 4),
                                      Text(
                                        _isEmailLogin
                                            ? 'Use Phone'
                                            : 'Use Email',
                                        style: const TextStyle(
                                          fontSize: 12.5,
                                          fontWeight: FontWeight.bold,
                                          color: _green,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),

                          const SizedBox(height: 10),

                          // Forgot password link
                          Align(
                            alignment: Alignment.centerRight,
                            child: GestureDetector(
                              onTap: () => context.push(
                                '/forgot-password',
                                extra: _isEmailLogin
                                    ? _emailController.text.trim()
                                    : '',
                              ),
                              child: const Padding(
                                padding: EdgeInsets.symmetric(vertical: 4),
                                child: Text(
                                  'Forgot Password?',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: _green,
                                  ),
                                ),
                              ),
                            ),
                          ),

                          const SizedBox(height: 18),

                          // Continue Button
                          _buildContinueButton(authState),

                          // Error message
                          if (authState.errorMessage != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 10,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.red.shade50,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: Colors.red.shade200,
                                    width: 1,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.error_outline_rounded,
                                      color: Colors.red.shade400,
                                      size: 18,
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        authState.errorMessage!,
                                        style: TextStyle(
                                          color: Colors.red.shade700,
                                          fontSize: 12.5,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),

                          const SizedBox(height: 20),

                          if (authState.errorMessage != null &&
                              authState.status == AuthStatus.unauthenticated)
                            TextButton(
                              onPressed: ref
                                  .read(authProvider.notifier)
                                  .checkAuthStatus,
                              child: const Text('Retry saved session'),
                            ),

                          // OR Divider
                          Row(
                            children: [
                              Expanded(
                                child: Container(
                                  height: 1,
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [
                                        Colors.transparent,
                                        Colors.grey.shade300,
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                ),
                                child: Text(
                                  'OR',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Colors.grey.shade400,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 1.5,
                                  ),
                                ),
                              ),
                              Expanded(
                                child: Container(
                                  height: 1,
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [
                                        Colors.grey.shade300,
                                        Colors.transparent,
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),

                          const SizedBox(height: 20),

                          // Google Sign In
                          _buildGoogleButton(authState),

                          const SizedBox(height: 24),

                          // Sign Up Link
                          Center(
                            child: GestureDetector(
                              onTap: () => context.push('/signup'),
                              child: const Padding(
                                padding: EdgeInsets.symmetric(vertical: 6),
                                child: Text.rich(
                                  TextSpan(
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: Color(0xFF6B7280),
                                      fontWeight: FontWeight.w500,
                                    ),
                                    children: [
                                      TextSpan(text: "Don't have an account? "),
                                      TextSpan(
                                        text: 'Sign Up',
                                        style: TextStyle(
                                          color: _green,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),

                          const SizedBox(height: 12),

                          // Legal
                          Center(
                            child: Text(
                              'By continuing, you agree to our Terms of Service\n& Privacy Policy',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 11,
                                color: Colors.grey.shade400,
                                height: 1.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Input Fields ──

  Widget _buildPhoneInputField() => AuthPhoneField(
    key: const ValueKey('phone_input'),
    controller: _phoneController,
    onSubmitted: (_) => _handleContinue(),
  );

  Widget _buildEmailInputField() {
    return Container(
      key: const ValueKey('email_input'),
      height: 56,
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE5E7EB), width: 1.5),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: TextField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: Color(0xFF111827),
        ),
        decoration: InputDecoration(
          hintText: 'name@example.com',
          hintStyle: const TextStyle(
            color: Color(0xFFBBBBBB),
            fontSize: 15,
            fontWeight: FontWeight.normal,
          ),
          prefixIcon: Container(
            padding: const EdgeInsets.all(10),
            child: const Icon(
              Icons.email_outlined,
              color: Color(0xFF9CA3AF),
              size: 22,
            ),
          ),
          border: InputBorder.none,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(vertical: 16),
        ),
        onSubmitted: (_) => _handleContinue(),
      ),
    );
  }

  // ── Continue Button ──

  Widget _buildContinueButton(AuthState authState) {
    final isLoading = authState.status == AuthStatus.loading;

    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 54),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF013A1D), Color(0xFF01501E)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(27),
        border: Border.all(
          color: _neonGreen.withValues(alpha: 0.5),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: _neonGreen.withValues(alpha: 0.25),
            blurRadius: 20,
            spreadRadius: 0,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(27),
          ),
        ),
        onPressed: isLoading ? null : _handleContinue,
        child: isLoading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: Colors.white,
                ),
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
                      letterSpacing: 0.5,
                    ),
                  ),
                  SizedBox(width: 8),
                  Icon(
                    Icons.arrow_forward_rounded,
                    color: Colors.white,
                    size: 20,
                  ),
                ],
              ),
      ),
    );
  }

  // ── Google Sign In Button ──

  Widget _buildGoogleButton(AuthState authState) {
    final isLoading = authState.status == AuthStatus.loading;

    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 54),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE5E7EB), width: 1.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: GoogleSignInButton(
        style: OutlinedButton.styleFrom(
          side: BorderSide.none,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16),
        ),
        enabled: !isLoading,
        onIdToken: ref.read(authProvider.notifier).signInWithGoogle,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              'assets/images/google_logo.png',
              width: 22,
              height: 22,
              errorBuilder: (_, __, ___) => const Icon(
                Icons.g_mobiledata_rounded,
                color: Color(0xFF4285F4),
                size: 24,
              ),
            ),
            const SizedBox(width: 12),
            const Flexible(
              child: Text(
                'Sign in with Google',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF111827),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Continue Action Handler ──

  void _handleContinue() {
    if (ref.read(authProvider).status == AuthStatus.loading) return;

    if (_isEmailLogin) {
      final email = _emailController.text.trim();
      if (email.isEmpty || !email.contains('@')) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Please enter a valid email address.'),
            backgroundColor: Colors.red.shade600,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
          ),
        );
        return;
      }
      ref
          .read(authProvider.notifier)
          .login(LoginRequest(email: email), 'email');
    } else {
      final raw = _phoneController.text.trim();
      final fullPhone = normalizeAuthPhone(raw);
      if (fullPhone == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Please enter a valid 10-digit phone number.'),
            backgroundColor: Colors.red.shade600,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
          ),
        );
        return;
      }
      ref
          .read(authProvider.notifier)
          .login(LoginRequest(phone: fullPhone), 'phone');
    }
  }
}
