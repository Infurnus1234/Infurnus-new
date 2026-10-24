import 'dart:async';
import 'dart:math';

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
    with TickerProviderStateMixin {
  late AnimationController _mainController;
  late AnimationController _pulseController;
  late AnimationController _particleController;

  late Animation<double> _logoScaleAnimation;
  late Animation<double> _logoFadeAnimation;
  late Animation<double> _titleFadeAnimation;
  late Animation<Offset> _titleSlideAnimation;
  late Animation<double> _taglineFadeAnimation;
  late Animation<double> _glowAnimation;
  late Animation<double> _bottomFadeAnimation;

  bool _navigated = false;
  Timer? _safetyTimer;
  Timer? _delayTimer;
  Timer? _listenerTimer;

  @override
  void initState() {
    super.initState();

    // Main entrance animation (1.4s)
    _mainController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );

    // Continuous pulse glow
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);

    // Particle floating animation
    _particleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 4000),
    )..repeat();

    _logoScaleAnimation = Tween<double>(begin: 0.3, end: 1.0).animate(
      CurvedAnimation(
        parent: _mainController,
        curve: const Interval(0.0, 0.5, curve: Curves.easeOutBack),
      ),
    );

    _logoFadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _mainController,
        curve: const Interval(0.0, 0.4, curve: Curves.easeOut),
      ),
    );

    _titleFadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _mainController,
        curve: const Interval(0.3, 0.65, curve: Curves.easeOut),
      ),
    );

    _titleSlideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.3), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _mainController,
            curve: const Interval(0.3, 0.65, curve: Curves.easeOutCubic),
          ),
        );

    _taglineFadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _mainController,
        curve: const Interval(0.55, 0.85, curve: Curves.easeOut),
      ),
    );

    _glowAnimation = Tween<double>(begin: 0.2, end: 0.6).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _bottomFadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _mainController,
        curve: const Interval(0.7, 1.0, curve: Curves.easeOut),
      ),
    );

    _mainController.forward();

    // Safety timeout — navigate after 3.5 seconds regardless
    _safetyTimer = Timer(const Duration(milliseconds: 3500), () {
      if (mounted && !_navigated) {
        _handleNavigation(ref.read(authProvider).status);
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Delay check slightly to let the animation play
      _delayTimer = Timer(const Duration(milliseconds: 2500), () {
        if (mounted && !_navigated) {
          final currentStatus = ref.read(authProvider).status;
          if (currentStatus != AuthStatus.initial) {
            _handleNavigation(currentStatus);
          }
        }
      });
    });
  }

  @override
  void dispose() {
    _safetyTimer?.cancel();
    _delayTimer?.cancel();
    _listenerTimer?.cancel();
    _mainController.dispose();
    _pulseController.dispose();
    _particleController.dispose();
    super.dispose();
  }

  Future<void> _handleNavigation(AuthStatus status) async {
    if (_navigated || !mounted) return;
    _navigated = true;

    if (status == AuthStatus.authenticated) {
      if (mounted) context.go('/customer-home');
      return;
    }

    // For unauthenticated or initial fallback, check onboarding
    try {
      final onboardingDone = await ref
          .read(secureStorageProvider)
          .read(key: 'onboarding_completed');

      if (!mounted) return;

      if (onboardingDone == 'true') {
        context.go('/login');
      } else {
        context.go('/welcome');
      }
    } catch (_) {
      if (mounted) context.go('/welcome');
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authProvider, (previous, next) {
      if (next.status != AuthStatus.initial && !_navigated) {
        // Give time for animation before navigating
        _listenerTimer?.cancel();
        _listenerTimer = Timer(const Duration(milliseconds: 1500), () {
          if (mounted && !_navigated) {
            _handleNavigation(next.status);
          }
        });
      }
    });

    return Scaffold(
      backgroundColor: AppColors.logoBackground,
      body: AnimatedBuilder(
        animation: Listenable.merge([
          _mainController,
          _pulseController,
          _particleController,
        ]),
        builder: (context, child) {
          return Container(
            decoration: const BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0, -0.15),
                radius: 1.15,
                colors: [
                  Color(0xFF042F1A),
                  Color(0xFF02170D),
                  Color(0xFF000000),
                ],
              ),
            ),
            child: Stack(
              children: [
                // Floating particles
                ..._buildParticles(),

                // Main content
                SafeArea(
                  child: Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Spacer(flex: 3),

                        // Animated Logo with pulsing glow
                        ScaleTransition(
                          scale: _logoScaleAnimation,
                          child: FadeTransition(
                            opacity: _logoFadeAnimation,
                            child: Container(
                              width: 130,
                              height: 130,
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Colors.black,
                                borderRadius: BorderRadius.circular(28),
                                boxShadow: [
                                  BoxShadow(
                                    color: AppColors.emeraldNeon.withValues(
                                      alpha: _glowAnimation.value,
                                    ),
                                    blurRadius: 50,
                                    spreadRadius: 6,
                                  ),
                                  BoxShadow(
                                    color: AppColors.emeraldNeon.withValues(
                                      alpha: _glowAnimation.value * 0.3,
                                    ),
                                    blurRadius: 90,
                                    spreadRadius: 16,
                                  ),
                                ],
                              ),
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(18),
                                child: Image.asset(
                                  'assets/images/infurnus_logo.png',
                                  fit: BoxFit.contain,
                                  errorBuilder: (context, error, stackTrace) =>
                                      const InfurnusBrandMark(
                                        iconSize: 84,
                                        showText: false,
                                      ),
                                ),
                              ),
                            ),
                          ),
                        ),

                        const SizedBox(height: 24),

                        // Animated Title
                        SlideTransition(
                          position: _titleSlideAnimation,
                          child: FadeTransition(
                            opacity: _titleFadeAnimation,
                            child: const Text(
                              'INFURNUS',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 36,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 6,
                              ),
                            ),
                          ),
                        ),

                        const SizedBox(height: 14),

                        // Animated Tagline with shimmer-like reveal
                        FadeTransition(
                          opacity: _taglineFadeAnimation,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 20,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: AppColors.emeraldNeon.withValues(
                                  alpha: 0.2,
                                ),
                                width: 1,
                              ),
                            ),
                            child: Text(
                              'Move  •  Haul  •  Rise',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                letterSpacing: 3,
                                color: AppColors.emeraldNeon.withValues(
                                  alpha: 0.9,
                                ),
                              ),
                            ),
                          ),
                        ),

                        const Spacer(flex: 3),

                        // Bottom loader with fade-in
                        FadeTransition(
                          opacity: _bottomFadeAnimation,
                          child: Column(
                            children: [
                              SizedBox(
                                width: 28,
                                height: 28,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    AppColors.emeraldNeon.withValues(
                                      alpha: 0.8,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 16),
                              Text(
                                'Getting things ready...',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w400,
                                  letterSpacing: 0.5,
                                  color: Colors.white.withValues(alpha: 0.4),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 48),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  List<Widget> _buildParticles() {
    final random = Random(42); // Fixed seed for consistent positions
    return List.generate(12, (index) {
      final startX = random.nextDouble();
      final startY = random.nextDouble();
      final size = 2.0 + random.nextDouble() * 3;
      final speed = 0.5 + random.nextDouble() * 1.5;
      final delay = random.nextDouble();

      return Positioned(
        left: MediaQuery.of(context).size.width * startX,
        top:
            MediaQuery.of(context).size.height *
            ((startY + _particleController.value * speed * 0.1 + delay) % 1.0),
        child: Opacity(
          opacity:
              (0.15 +
                      sin(_particleController.value * pi * 2 + delay * pi * 2) *
                          0.15)
                  .clamp(0.0, 1.0),
          child: Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.emeraldNeon,
              boxShadow: [
                BoxShadow(
                  color: AppColors.emeraldNeon.withValues(alpha: 0.3),
                  blurRadius: size * 2,
                ),
              ],
            ),
          ),
        ),
      );
    });
  }
}
