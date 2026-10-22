import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/auth_models.dart';
import '../providers/auth_provider.dart';
import '../providers/user_provider.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // ── Login controllers ──
  final _loginPhoneController = TextEditingController();
  final _loginEmailController = TextEditingController();
  bool _isEmailLogin = false;
  bool _rememberMe = true;

  // ── Signup controllers ──
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _signupEmailController = TextEditingController();
  final _signupPhoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isSignupEmail = false;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  String? _signupError;

  static const _green = Color(0xFF00A859);
  static const _darkGreen = Color(0xFF012010);
  static const _neonGreen = Color(0xFF00E676);

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _loginPhoneController.dispose();
    _loginEmailController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _signupEmailController.dispose();
    _signupPhoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
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

    return Scaffold(
      backgroundColor: Colors.black,
      resizeToAvoidBottomInset: true,
      body: Column(
        children: [
          // ── TOP: Compact hero banner (~35% screen) ──
          SizedBox(
            height: screenHeight * 0.30,
            width: double.infinity,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(
                  'assets/images/login_hero_banner.jpg',
                  fit: BoxFit.cover,
                  alignment: Alignment.topCenter,
                  errorBuilder: (_, __, ___) => Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Color(0xFF01180B), Color(0xFF000000)],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                  ),
                ),
                // Gradient overlay at bottom of banner
                Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.transparent,
                          Colors.black.withValues(alpha: 0.3),
                          Colors.black.withValues(alpha: 0.7),
                        ],
                        stops: const [0.4, 0.75, 1.0],
                      ),
                    ),
                  ),
                ),
                // Logo & tagline at top
                SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Image.asset(
                          'assets/images/infurnus_3d_logo.png',
                          height: 44,
                          fit: BoxFit.contain,
                          errorBuilder: (_, __, ___) => const Text(
                            'INFURNUS',
                            style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 2,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Move. Haul. Rise.',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: _neonGreen,
                            letterSpacing: 1.2,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),

          // ── BOTTOM: White rounded card with tabs ──
          Expanded(
            child: Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x44000000),
                    blurRadius: 20,
                    offset: Offset(0, -6),
                  ),
                ],
              ),
              child: Column(
                children: [
                  const SizedBox(height: 16),

                  // ── Tab Switcher Pills ──
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Container(
                      height: 46,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(25),
                      ),
                      child: TabBar(
                        controller: _tabController,
                        indicator: BoxDecoration(
                          color: _darkGreen,
                          borderRadius: BorderRadius.circular(23),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x55000000),
                              blurRadius: 8,
                              offset: Offset(0, 2),
                            ),
                          ],
                        ),
                        indicatorSize: TabBarIndicatorSize.tab,
                        dividerColor: Colors.transparent,
                        labelColor: Colors.white,
                        unselectedLabelColor: const Color(0xFF6B7280),
                        labelStyle: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                        unselectedLabelStyle: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                        tabs: const [
                          Tab(text: 'Log In'),
                          Tab(text: 'Sign Up'),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 4),

                  // ── Tab Views ──
                  Expanded(
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        _buildLoginTab(authState),
                        _buildSignupTab(authState),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ════════════════════════════════════════
  //  LOG IN TAB
  // ════════════════════════════════════════
  Widget _buildLoginTab(AuthState authState) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Phone / Email Input
          if (!_isEmailLogin) _buildPhoneInput(_loginPhoneController) else _buildEmailInput(_loginEmailController),
          const SizedBox(height: 14),

          // Remember me + toggle
          Row(
            children: [
              SizedBox(
                width: 22,
                height: 22,
                child: Checkbox(
                  value: _rememberMe,
                  activeColor: _green,
                  checkColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
                  side: const BorderSide(color: _green, width: 2),
                  onChanged: (val) => setState(() => _rememberMe = val ?? true),
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
                onTap: () => setState(() => _isEmailLogin = !_isEmailLogin),
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

          // Continue Button
          _ActionButton(
            label: 'Continue',
            isLoading: authState.status == AuthStatus.loading,
            onPressed: _handleLogin,
          ),

          const SizedBox(height: 20),

          // OR divider
          _OrDivider(),

          const SizedBox(height: 18),

          // Google Sign-In
          _GoogleButton(
            onPressed: () => ref.read(authProvider.notifier).signInWithGoogle('dummy-google-token'),
          ),

          // Error message
          if (authState.errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Center(
                child: Text(
                  authState.errorMessage!,
                  style: const TextStyle(color: Colors.red, fontSize: 13, fontWeight: FontWeight.w500),
                  textAlign: TextAlign.center,
                ),
              ),
            ),

          const SizedBox(height: 22),

          // Legal
          _LegalText(),
        ],
      ),
    );
  }

  // ════════════════════════════════════════
  //  SIGN UP TAB
  // ════════════════════════════════════════
  Widget _buildSignupTab(AuthState authState) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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

          // Phone or Email
          if (!_isSignupEmail)
            _buildPhoneInput(_signupPhoneController)
          else
            _buildInputBox(
              controller: _signupEmailController,
              hint: 'Enter Email Address',
              icon: Icons.email_outlined,
              keyboardType: TextInputType.emailAddress,
            ),

          const SizedBox(height: 6),

          // Toggle email/phone
          Align(
            alignment: Alignment.centerRight,
            child: GestureDetector(
              onTap: () => setState(() => _isSignupEmail = !_isSignupEmail),
              child: Text(
                _isSignupEmail ? 'Use Phone' : 'Use Email',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  color: _green,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),

          // Password
          _buildInputBox(
            controller: _passwordController,
            hint: 'Password',
            icon: Icons.lock_outline_rounded,
            obscureText: _obscurePassword,
            suffixIcon: IconButton(
              icon: Icon(
                _obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                color: const Color(0xFF6B7280),
                size: 20,
              ),
              onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
            ),
          ),
          const SizedBox(height: 10),

          // Confirm Password
          _buildInputBox(
            controller: _confirmPasswordController,
            hint: 'Confirm Password',
            icon: Icons.lock_outline_rounded,
            obscureText: _obscureConfirm,
            suffixIcon: IconButton(
              icon: Icon(
                _obscureConfirm ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                color: const Color(0xFF6B7280),
                size: 20,
              ),
              onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
            ),
          ),

          const SizedBox(height: 18),

          // Validation error
          if (_signupError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Center(
                child: Text(
                  _signupError!,
                  style: const TextStyle(color: Colors.red, fontSize: 13, fontWeight: FontWeight.w500),
                  textAlign: TextAlign.center,
                ),
              ),
            ),

          // Sign Up Button
          _ActionButton(
            label: 'Sign Up  →',
            isLoading: authState.status == AuthStatus.loading,
            onPressed: _handleSignup,
          ),

          const SizedBox(height: 18),

          _OrDivider(),

          const SizedBox(height: 16),

          _GoogleButton(
            onPressed: () => ref.read(authProvider.notifier).signInWithGoogle('dummy-google-token'),
          ),

          if (authState.errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Center(
                child: Text(
                  authState.errorMessage!,
                  style: const TextStyle(color: Colors.red, fontSize: 13, fontWeight: FontWeight.w500),
                  textAlign: TextAlign.center,
                ),
              ),
            ),

          const SizedBox(height: 20),
          _LegalText(),
        ],
      ),
    );
  }

  // ── Input Widgets ──

  Widget _buildPhoneInput(TextEditingController controller) {
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
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF111827)),
          ),
          const SizedBox(width: 4),
          const Icon(Icons.keyboard_arrow_down_rounded, color: Color(0xFF6B7280), size: 20),
          const SizedBox(width: 8),
          Container(width: 1, height: 22, color: const Color(0xFFE5E7EB)),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: controller,
              keyboardType: TextInputType.phone,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF111827)),
              decoration: const InputDecoration(
                hintText: 'Enter Phone Number',
                border: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 12),
                hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 15, fontWeight: FontWeight.normal),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailInput(TextEditingController controller) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      child: TextField(
        controller: controller,
        keyboardType: TextInputType.emailAddress,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF111827)),
        decoration: const InputDecoration(
          hintText: 'Enter Email Address',
          prefixIcon: Icon(Icons.email_outlined, color: Color(0xFF6B7280), size: 20),
          border: InputBorder.none,
          isDense: true,
          contentPadding: EdgeInsets.symmetric(vertical: 12),
          hintStyle: TextStyle(color: Color(0xFF9CA3AF), fontSize: 15),
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
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF111827)),
      ),
    );
  }

  // ── Handlers ──

  void _handleLogin() {
    if (ref.read(authProvider).status == AuthStatus.loading) return;
    if (_isEmailLogin) {
      final email = _loginEmailController.text.trim();
      if (email.isNotEmpty) {
        ref.read(authProvider.notifier).login(LoginRequest(email: email), 'email');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your email address.')),
        );
      }
    } else {
      final raw = _loginPhoneController.text.trim();
      if (raw.isNotEmpty) {
        final clean = raw.replaceAll(RegExp(r'[^\d+]'), '');
        final fullPhone = clean.startsWith('+') ? clean : '+91$clean';
        ref.read(authProvider.notifier).login(LoginRequest(phone: fullPhone), 'phone');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please enter your phone number.')),
        );
      }
    }
  }

  void _handleSignup() {
    setState(() => _signupError = null);
    final firstName = _firstNameController.text.trim();
    final lastName = _lastNameController.text.trim();
    if (firstName.isEmpty || lastName.isEmpty) {
      setState(() => _signupError = 'Please enter your first and last name.');
      return;
    }
    if (_isSignupEmail && _signupEmailController.text.trim().isEmpty) {
      setState(() => _signupError = 'Please enter a valid email address.');
      return;
    }
    if (!_isSignupEmail && _signupPhoneController.text.trim().isEmpty) {
      setState(() => _signupError = 'Please enter a valid phone number.');
      return;
    }
    final password = _passwordController.text;
    final confirmPassword = _confirmPasswordController.text;
    if (password.length < 8 || password.length > 128) {
      setState(() => _signupError = 'Password must be 8–128 characters.');
      return;
    }
    if (password != confirmPassword) {
      setState(() => _signupError = 'Passwords do not match.');
      return;
    }
    String? email;
    String? phone;
    if (_isSignupEmail) {
      email = _signupEmailController.text.trim();
    } else {
      final p = _signupPhoneController.text.trim().replaceAll(RegExp(r'[^\d+]'), '');
      phone = p.startsWith('+') ? p : '+91$p';
    }
    ref.read(authProvider.notifier).signup(SignupRequest(
      firstName: firstName,
      lastName: lastName,
      email: email,
      phone: phone,
      password: password,
      confirmPassword: confirmPassword,
      role: 'customer',
    ));
  }
}

// ════════════════════════════════════════
//  SHARED SMALL WIDGETS
// ════════════════════════════════════════

class _ActionButton extends StatelessWidget {
  final String label;
  final bool isLoading;
  final VoidCallback onPressed;
  const _ActionButton({required this.label, required this.isLoading, required this.onPressed});

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
          BoxShadow(color: Color(0x6600E676), blurRadius: 18, spreadRadius: 2),
        ],
      ),
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(27)),
        ),
        onPressed: isLoading ? null : onPressed,
        child: isLoading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
              )
            : Text(
                label,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  letterSpacing: 0.4,
                ),
              ),
      ),
    );
  }
}

class _OrDivider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Divider(color: Color(0xFFD1D5DB), thickness: 1)),
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
        const Expanded(child: Divider(color: Color(0xFFD1D5DB), thickness: 1)),
      ],
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
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
        ),
        onPressed: onPressed,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: Center(
                child: Image.network(
                  'https://www.google.com/favicon.ico',
                  width: 18,
                  height: 18,
                  errorBuilder: (_, __, ___) => const Text(
                    'G',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF4285F4)),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            const Text(
              'Continue with Google',
              style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.bold, color: Color(0xFF111827)),
            ),
          ],
        ),
      ),
    );
  }
}

class _LegalText extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        'By continuing, you agree to our Terms of Service,\nPrivacy Policy & Content Policy',
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 11, color: Colors.grey.shade400, height: 1.5),
      ),
    );
  }
}
