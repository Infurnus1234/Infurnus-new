import 'package:flutter/material.dart';
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

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  bool _isEmailLogin = false;
  bool _rememberMe = true;

  // Sign up quick-modal controllers
  final _signUpFirstNameController = TextEditingController();
  final _signUpLastNameController = TextEditingController();
  final _signUpPhoneController = TextEditingController();
  final _signUpEmailController = TextEditingController();
  final _signUpPasswordController = TextEditingController();
  final _signUpConfirmPasswordController = TextEditingController();
  String _selectedRole = 'customer';
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  String? _modalError;

  static const _green = Color(0xFF00A859);
  static const _darkGreen = Color(0xFF012010);
  static const _neonGreen = Color(0xFF00E676);

  @override
  void dispose() {
    _phoneController.dispose();
    _emailController.dispose();
    _signUpFirstNameController.dispose();
    _signUpLastNameController.dispose();
    _signUpPhoneController.dispose();
    _signUpEmailController.dispose();
    _signUpPasswordController.dispose();
    _signUpConfirmPasswordController.dispose();
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

    // Responsive banner height:
    // Takes ~55-58% of screen when keyboard is closed to display the full artwork,
    // and compacts gracefully when keyboard opens so inputs remain accessible.
    final bannerHeight = isKeyboardOpen
        ? (screenHeight * 0.22).clamp(160.0, 220.0)
        : (screenHeight * 0.58).clamp(340.0, 560.0);

    return Scaffold(
      backgroundColor: Colors.black,
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          // ── TOP: Full Artwork Banner ──
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: bannerHeight,
            child: Image.asset(
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
          ),

          // ── BOTTOM: White Sheet with Rounded Corners ──
          Positioned(
            top: bannerHeight - 24, // 24px overlap over the road
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x33000000),
                    blurRadius: 18,
                    offset: Offset(0, -4),
                  ),
                ],
              ),
              child: SafeArea(
                top: false,
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(22, 22, 22, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Title
                      const Text(
                        'Log in or sign up',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 23,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF111827),
                          letterSpacing: -0.3,
                        ),
                      ),

                      const SizedBox(height: 18),

                      // Phone or Email Input Container
                      if (!_isEmailLogin)
                        _buildPhoneInputField()
                      else
                        _buildEmailInputField(),

                      const SizedBox(height: 12),

                      // Checkbox + Remember me + Use Email toggle
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
                                borderRadius: BorderRadius.circular(5),
                              ),
                              side: const BorderSide(color: _green, width: 2),
                              onChanged: (val) {
                                setState(() => _rememberMe = val ?? true);
                              },
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
                            onTap: () {
                              setState(() => _isEmailLogin = !_isEmailLogin);
                            },
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Text(
                                _isEmailLogin ? 'Use Phone' : 'Use Email',
                                style: const TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.bold,
                                  color: _green,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 18),

                      // Continue Button (Pill with glowing neon-green border)
                      _buildContinueButton(authState),

                      // Error message if any
                      if (authState.errorMessage != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: Text(
                            authState.errorMessage!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.red,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),

                      const SizedBox(height: 16),

                      // OR Divider
                      const Row(
                        children: [
                          Expanded(
                            child: Divider(
                              color: Color(0xFFE5E7EB),
                              thickness: 1.2,
                            ),
                          ),
                          Padding(
                            padding: EdgeInsets.symmetric(horizontal: 14),
                            child: Text(
                              'OR',
                              style: TextStyle(
                                fontSize: 12,
                                color: Color(0xFF9CA3AF),
                                fontWeight: FontWeight.w600,
                                letterSpacing: 1.2,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Divider(
                              color: Color(0xFFE5E7EB),
                              thickness: 1.2,
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 16),

                      // Sign in with Google Button
                      _buildGoogleButton(authState),

                      const SizedBox(height: 18),

                      // Footer: Create a Customer account
                      Center(
                        child: GestureDetector(
                          onTap: _showCreateAccountSheet,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 6),
                            child: RichText(
                              text: const TextSpan(
                                style: TextStyle(
                                  fontSize: 14,
                                  color: Color(0xFF111827),
                                  fontWeight: FontWeight.w700,
                                ),
                                children: [
                                  TextSpan(text: 'Create a '),
                                  TextSpan(
                                    text: 'Customer',
                                    style: TextStyle(
                                      color: _green,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  TextSpan(text: ' account'),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
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

  Widget _buildPhoneInputField() {
    return Container(
      height: 52,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Row(
        children: [
          const Text('🇮🇳', style: TextStyle(fontSize: 20)),
          const SizedBox(width: 8),
          const Text(
            '+91',
            style: TextStyle(
              fontSize: 15.5,
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
          const SizedBox(width: 10),
          Container(
            width: 1,
            height: 24,
            color: const Color(0xFFE5E7EB),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              style: const TextStyle(
                fontSize: 15.5,
                fontWeight: FontWeight.w600,
                color: Color(0xFF111827),
              ),
              decoration: const InputDecoration(
                hintText: 'Enter Phone Number',
                hintStyle: TextStyle(
                  color: Color(0xFF9CA3AF),
                  fontSize: 15,
                  fontWeight: FontWeight.normal,
                ),
                border: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 14),
              ),
              onSubmitted: (_) => _handleContinue(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailInputField() {
    return Container(
      height: 52,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: TextField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        style: const TextStyle(
          fontSize: 15.5,
          fontWeight: FontWeight.w600,
          color: Color(0xFF111827),
        ),
        decoration: const InputDecoration(
          hintText: 'Enter Email Address',
          hintStyle: TextStyle(
            color: Color(0xFF9CA3AF),
            fontSize: 15,
            fontWeight: FontWeight.normal,
          ),
          prefixIcon: Icon(
            Icons.email_outlined,
            color: Color(0xFF6B7280),
            size: 20,
          ),
          border: InputBorder.none,
          isDense: true,
          contentPadding: EdgeInsets.symmetric(vertical: 14),
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
      height: 52,
      decoration: BoxDecoration(
        color: _darkGreen,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: _neonGreen, width: 1.3),
        boxShadow: const [
          BoxShadow(
            color: Color(0x6600E676),
            blurRadius: 18,
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
            : const Text(
                'Continue  →',
                style: TextStyle(
                  fontSize: 16.5,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  letterSpacing: 0.3,
                ),
              ),
      ),
    );
  }

  // ── Google Sign In Button ──

  Widget _buildGoogleButton(AuthState authState) {
    final isLoading = authState.status == AuthStatus.loading;

    return Container(
      width: double.infinity,
      height: 50,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFD1D5DB), width: 1.2),
      ),
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          side: BorderSide.none,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16),
        ),
        onPressed: isLoading
            ? null
            : () {
                ref
                    .read(authProvider.notifier)
                    .signInWithGoogle('dummy-google-token');
              },
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              'assets/images/google_logo.png',
              width: 22,
              height: 22,
              errorBuilder: (_, __, ___) => Image.network(
                'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/1200px-Google_%22G%22_logo.svg.png',
                width: 22,
                height: 22,
                errorBuilder: (_, __, ___) => const Icon(
                  Icons.g_mobiledata_rounded,
                  color: Color(0xFF4285F4),
                  size: 24,
                ),
              ),
            ),
            const SizedBox(width: 12),
            const Text(
              'Sign in with Google',
              style: TextStyle(
                fontSize: 15.5,
                fontWeight: FontWeight.w600,
                color: Color(0xFF111827),
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
          const SnackBar(content: Text('Please enter a valid email address.')),
        );
        return;
      }
      ref
          .read(authProvider.notifier)
          .login(LoginRequest(email: email), 'email');
    } else {
      final raw = _phoneController.text.trim();
      final clean = raw.replaceAll(RegExp(r'[^\d+]'), '');
      if (clean.isEmpty || clean.length < 10) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Please enter a valid 10-digit phone number.'),
          ),
        );
        return;
      }
      final fullPhone = clean.startsWith('+') ? clean : '+91$clean';
      ref
          .read(authProvider.notifier)
          .login(LoginRequest(phone: fullPhone), 'phone');
    }
  }

  // ── Account Creation Bottom Sheet ──

  void _showCreateAccountSheet() {
    // Pre-populate phone or email from current login field
    if (!_isEmailLogin && _phoneController.text.isNotEmpty) {
      _signUpPhoneController.text = _phoneController.text.trim();
    } else if (_isEmailLogin && _emailController.text.isNotEmpty) {
      _signUpEmailController.text = _emailController.text.trim();
    }

    setState(() => _modalError = null);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              padding: EdgeInsets.fromLTRB(
                22,
                20,
                22,
                MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Pull pill
                    Center(
                      child: Container(
                        width: 44,
                        height: 4,
                        decoration: BoxDecoration(
                          color: const Color(0xFFD1D5DB),
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    const Text(
                      'Create an Account',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Join Infurnus — Your all-in-one mobility partner',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Role Selector Chips
                    Row(
                      children: [
                        _roleChip('customer', 'Customer', setModalState),
                        const SizedBox(width: 8),
                        _roleChip('driver', 'Driver', setModalState),
                        const SizedBox(width: 8),
                        _roleChip('partner', 'Partner', setModalState),
                      ],
                    ),
                    const SizedBox(height: 14),

                    // Names
                    Row(
                      children: [
                        Expanded(
                          child: _modalInput(
                            controller: _signUpFirstNameController,
                            hint: 'First Name',
                            icon: Icons.person_outline_rounded,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _modalInput(
                            controller: _signUpLastNameController,
                            hint: 'Last Name',
                            icon: Icons.person_outline_rounded,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),

                    // Phone & Email
                    _modalInput(
                      controller: _signUpPhoneController,
                      hint: 'Phone Number (+91)',
                      icon: Icons.phone_outlined,
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 10),
                    _modalInput(
                      controller: _signUpEmailController,
                      hint: 'Email Address',
                      icon: Icons.email_outlined,
                      keyboardType: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: 10),

                    // Password
                    _modalInput(
                      controller: _signUpPasswordController,
                      hint: 'Password (min 8 chars)',
                      icon: Icons.lock_outline_rounded,
                      obscureText: _obscurePassword,
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscurePassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          size: 20,
                          color: const Color(0xFF6B7280),
                        ),
                        onPressed: () {
                          setModalState(
                            () => _obscurePassword = !_obscurePassword,
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 10),

                    // Confirm Password
                    _modalInput(
                      controller: _signUpConfirmPasswordController,
                      hint: 'Confirm Password',
                      icon: Icons.lock_outline_rounded,
                      obscureText: _obscureConfirmPassword,
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscureConfirmPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          size: 20,
                          color: const Color(0xFF6B7280),
                        ),
                        onPressed: () {
                          setModalState(
                            () => _obscureConfirmPassword =
                                !_obscureConfirmPassword,
                          );
                        },
                      ),
                    ),

                    if (_modalError != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        _modalError!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.red,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],

                    const SizedBox(height: 18),

                    // Submit Sign Up Button
                    Container(
                      height: 50,
                      decoration: BoxDecoration(
                        color: _darkGreen,
                        borderRadius: BorderRadius.circular(25),
                        border: Border.all(color: _neonGreen, width: 1.2),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x6600E676),
                            blurRadius: 14,
                            spreadRadius: 1,
                          ),
                        ],
                      ),
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.transparent,
                          shadowColor: Colors.transparent,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(25),
                          ),
                        ),
                        onPressed: () => _handleModalSignup(setModalState),
                        child: const Text(
                          'Create Account  →',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _roleChip(
    String role,
    String label,
    void Function(void Function()) setModalState,
  ) {
    final isSelected = _selectedRole == role;
    return Expanded(
      child: GestureDetector(
        onTap: () => setModalState(() => _selectedRole = role),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? _darkGreen : const Color(0xFFF3F4F6),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected ? _neonGreen : const Color(0xFFE5E7EB),
              width: 1.2,
            ),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
              color: isSelected ? Colors.white : const Color(0xFF4B5563),
            ),
          ),
        ),
      ),
    );
  }

  Widget _modalInput({
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: TextField(
        controller: controller,
        obscureText: obscureText,
        keyboardType: keyboardType,
        style: const TextStyle(
          fontSize: 14.5,
          fontWeight: FontWeight.w600,
          color: Color(0xFF111827),
        ),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
          prefixIcon: Icon(icon, color: const Color(0xFF6B7280), size: 20),
          suffixIcon: suffixIcon,
          border: InputBorder.none,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
        ),
      ),
    );
  }

  void _handleModalSignup(void Function(void Function()) setModalState) {
    final firstName = _signUpFirstNameController.text.trim();
    final lastName = _signUpLastNameController.text.trim();
    final phone = _signUpPhoneController.text.trim();
    final email = _signUpEmailController.text.trim();
    final password = _signUpPasswordController.text;
    final confirm = _signUpConfirmPasswordController.text;

    if (firstName.isEmpty || lastName.isEmpty) {
      setModalState(
        () => _modalError = 'Please enter your first and last name.',
      );
      return;
    }
    if (phone.isEmpty && email.isEmpty) {
      setModalState(() => _modalError = 'Please provide either phone or email.');
      return;
    }
    if (password.length < 8) {
      setModalState(
        () => _modalError = 'Password must be at least 8 characters.',
      );
      return;
    }
    if (password != confirm) {
      setModalState(() => _modalError = 'Passwords do not match.');
      return;
    }

    String? formattedPhone;
    if (phone.isNotEmpty) {
      final clean = phone.replaceAll(RegExp(r'[^\d+]'), '');
      formattedPhone = clean.startsWith('+') ? clean : '+91$clean';
    }

    Navigator.of(context).pop(); // close sheet

    ref.read(authProvider.notifier).signup(
          SignupRequest(
            firstName: firstName,
            lastName: lastName,
            email: email.isNotEmpty ? email : null,
            phone: formattedPhone,
            password: password,
            confirmPassword: confirm,
            role: _selectedRole,
          ),
        );
  }
}
