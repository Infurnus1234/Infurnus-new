import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/storage/secure_storage.dart';
import '../../../auth/presentation/providers/auth_provider.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with TickerProviderStateMixin {
  late AnimationController _fadeController;
  late AnimationController _progressController;
  late AnimationController _pulseController;

  late Animation<double> _contentFadeAnimation;
  late Animation<double> _glowAnimation;

  bool _navigated = false;
  Timer? _safetyTimer;
  Timer? _delayTimer;
  Timer? _listenerTimer;

  static const Color _neonGreen = Color(0xFF00E65B);
  static const Color _trackGrey = Color(0xFF262626);

  @override
  void initState() {
    super.initState();

    // 1. Smooth content fade-in (600ms)
    _fadeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );

    _contentFadeAnimation = CurvedAnimation(
      parent: _fadeController,
      curve: Curves.easeOut,
    );

    // 2. Linear/smooth progress bar animation across 2.2s
    _progressController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    );

    // 3. Subtle logo edge glow pulsation
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);

    _glowAnimation = Tween<double>(begin: 0.35, end: 0.75).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _fadeController.forward();
    _progressController.forward();

    // Safety timeout — navigate after 3.2 seconds regardless
    _safetyTimer = Timer(const Duration(milliseconds: 3200), () {
      if (mounted && !_navigated) {
        _handleNavigation(ref.read(authProvider).status);
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Allow progress bar to fill smoothly before navigating
      _delayTimer = Timer(const Duration(milliseconds: 2300), () {
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
    _fadeController.dispose();
    _progressController.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  Future<void> _handleNavigation(AuthStatus status) async {
    if (_navigated ||
        !mounted ||
        status == AuthStatus.initial ||
        status == AuthStatus.restoring) {
      return;
    }
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
        _listenerTimer?.cancel();
        // Give time for progress animation before transitioning
        _listenerTimer = Timer(const Duration(milliseconds: 1800), () {
          if (mounted && !_navigated) {
            _handleNavigation(next.status);
          }
        });
      }
    });

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: Colors.black,
        systemNavigationBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: Colors.black,
        body: FadeTransition(
          opacity: _contentFadeAnimation,
          child: SafeArea(
            child: SizedBox.expand(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Spacer(flex: 5),

                  // 1. Original 3D glowing shield logo with subtle pulsing glow
                  AnimatedBuilder(
                    animation: _glowAnimation,
                    builder: (context, child) {
                      return Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: _neonGreen.withValues(
                                alpha: _glowAnimation.value * 0.45,
                              ),
                              blurRadius: 40,
                              spreadRadius: 4,
                            ),
                            BoxShadow(
                              color: _neonGreen.withValues(
                                alpha: _glowAnimation.value * 0.2,
                              ),
                              blurRadius: 80,
                              spreadRadius: 12,
                            ),
                          ],
                        ),
                        child: child,
                      );
                    },
                    child: Image.asset(
                      'assets/images/infurnus_splash_logo.png',
                      width: 175,
                      height: 196,
                      fit: BoxFit.contain,
                      filterQuality: FilterQuality.high,
                    ),
                  ),

                  const SizedBox(height: 22),

                  // 2. Brand Name: "IN" in neon green + "FURNUS" in white
                  RichText(
                    text: const TextSpan(
                      children: [
                        TextSpan(
                          text: 'IN',
                          style: TextStyle(
                            color: _neonGreen,
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 3.5,
                            fontFamily: 'Inter',
                          ),
                        ),
                        TextSpan(
                          text: 'FURNUS',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 3.5,
                            fontFamily: 'Inter',
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 12),

                  // 3. Tagline: "Move. Haul. Rise."
                  const Text(
                    'Move.  Haul.  Rise.',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      letterSpacing: 2.5,
                    ),
                  ),

                  const SizedBox(height: 48),

                  // 4. Horizontal neon-green progress bar
                  SizedBox(
                    width: 160,
                    height: 5.5,
                    child: AnimatedBuilder(
                      animation: _progressController,
                      builder: (context, _) {
                        return ClipRRect(
                          borderRadius: BorderRadius.circular(3),
                          child: Stack(
                            children: [
                              // Dark track
                              Container(
                                width: double.infinity,
                                height: double.infinity,
                                color: _trackGrey,
                              ),
                              // Neon green fill
                              FractionallySizedBox(
                                widthFactor: _progressController.value.clamp(
                                  0.0,
                                  1.0,
                                ),
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: _neonGreen,
                                    boxShadow: [
                                      BoxShadow(
                                        color: _neonGreen.withValues(
                                          alpha: 0.8,
                                        ),
                                        blurRadius: 8,
                                        spreadRadius: 1,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),

                  const Spacer(flex: 5),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
