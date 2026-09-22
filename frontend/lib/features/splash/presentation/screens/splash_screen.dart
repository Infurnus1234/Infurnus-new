import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_brand_mark.dart';
import '../../../auth/presentation/providers/auth_provider.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _fadeAnimation;
  late Animation<double> _taglineFadeAnimation;
  bool _navigated = false;
  Timer? _safetyTimer;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _scaleAnimation = Tween<double>(begin: 0.82, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.7, curve: Curves.easeOut),
      ),
    );

    _taglineFadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.4, 1.0, curve: Curves.easeOut),
      ),
    );

    _controller.forward();

    // Safety timeout in case auth check takes unusually long
    _safetyTimer = Timer(const Duration(seconds: 4), () {
      if (mounted && !_navigated) {
        _handleNavigation(ref.read(authProvider).status);
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final currentStatus = ref.read(authProvider).status;
      if (currentStatus != AuthStatus.initial) {
        _handleNavigation(currentStatus);
      }
    });
  }

  @override
  void dispose() {
    _safetyTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleNavigation(AuthStatus status) async {
    if (_navigated || !mounted) return;
    _navigated = true;

    if (status == AuthStatus.authenticated) {
      if (mounted) context.go('/customer-home');
      return;
    }

    // For unauthenticated or initial fallback, check if onboarding was completed
    try {
      final onboardingDone = await ref
          .read(secureStorageProvider)
          .read(key: 'onboarding_completed');

      if (!mounted) return;

      if (onboardingDone == 'true') {
        context.go('/welcome');
      } else {
        context.go('/onboarding');
      }
    } catch (_) {
      if (mounted) context.go('/welcome');
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authProvider, (previous, next) {
      if (next.status != AuthStatus.initial && !_navigated) {
        _handleNavigation(next.status);
      }
    });

    return Scaffold(
      backgroundColor: AppColors.logoBackground,
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.1),
            radius: 0.95,
            colors: [
              Color(0xFF091A10), // subtle ambient emerald halo matching logo glow
              Color(0xFF000000), // deep pitch black matching logo canvas
            ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Spacer(flex: 3),
                // Animated Brand Mark & Hero Logo
                ScaleTransition(
                  scale: _scaleAnimation,
                  child: FadeTransition(
                    opacity: _fadeAnimation,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 112,
                          height: 112,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: AppColors.emeraldNeon.withValues(alpha: 0.4),
                                blurRadius: 40,
                                spreadRadius: 4,
                              ),
                            ],
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(24),
                            child: Image.asset(
                              'assets/images/logo.jpg',
                              fit: BoxFit.contain,
                              errorBuilder: (context, error, stackTrace) =>
                                  const InfurnusBrandMark(
                                iconSize: 84,
                                showText: false,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        const Text(
                          'INFURNUS',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 32,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 3.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                // Animated Tagline
                FadeTransition(
                  opacity: _taglineFadeAnimation,
                  child: Text(
                    'Move. Deliver. Serve.',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      letterSpacing: 2.8,
                      color: AppColors.emeraldNeon.withValues(alpha: 0.9),
                    ),
                  ),
                ),
                const Spacer(flex: 3),
                // Emerald neon spinning bottom loader
                const SizedBox(
                  width: 26,
                  height: 26,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      AppColors.emeraldNeon,
                    ),
                  ),
                ),
                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
