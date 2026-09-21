import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  final List<_OnboardingPageData> _pages = const [
    _OnboardingPageData(
      title: 'Your ride, your way',
      description: 'Book a Bike, Auto, Sedan or SUV whenever you need it.',
      icon: Icons.directions_car_filled_rounded,
      accentColor: Color(0xFF00C853),
      badgeText: 'PASSENGER MOBILITY',
    ),
    _OnboardingPageData(
      title: 'Move anything with ease',
      description: 'Send your goods safely with the right vehicle for your delivery.',
      icon: Icons.local_shipping_rounded,
      accentColor: Color(0xFFFF9800),
      badgeText: 'LOGISTICS & FREIGHT',
    ),
    _OnboardingPageData(
      title: 'More than just a ride',
      description:
          'Premium vehicles, towing, ambulance, JCB and roadside services — all in one place.',
      icon: Icons.stars_rounded,
      accentColor: Color(0xFFE91E63),
      badgeText: 'SERVICE & PREMIUM',
    ),
  ];

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _completeOnboarding() async {
    try {
      await ref
          .read(secureStorageProvider)
          .write(key: 'onboarding_completed', value: 'true');
    } catch (e) {
      debugPrint('Error saving onboarding state: $e');
    }
    if (mounted) {
      context.go('/welcome');
    }
  }

  void _nextPage() {
    if (_currentPage < _pages.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOutCubic,
      );
    } else {
      _completeOnboarding();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLastPage = _currentPage == _pages.length - 1;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        automaticallyImplyLeading: false,
        actions: [
          TextButton(
            onPressed: _completeOnboarding,
            child: Text(
              'Skip',
              style: TextStyle(
                color: Colors.grey[700],
                fontWeight: FontWeight.w600,
                fontSize: 15,
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: _pages.length,
                onPageChanged: (index) {
                  setState(() => _currentPage = index);
                },
                itemBuilder: (context, index) {
                  final page = _pages[index];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 28.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Illustration / Icon Container
                        Container(
                          width: 170,
                          height: 170,
                          decoration: BoxDecoration(
                            color: page.accentColor.withValues(alpha: 0.1),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: page.accentColor.withValues(alpha: 0.25),
                              width: 2,
                            ),
                          ),
                          alignment: Alignment.center,
                          child: Icon(
                            page.icon,
                            size: 84,
                            color: page.accentColor,
                          ),
                        ),
                        const SizedBox(height: 36),
                        // Badge
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 4),
                          decoration: BoxDecoration(
                            color: page.accentColor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            page.badgeText,
                            style: TextStyle(
                              color: page.accentColor,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.2,
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        // Title
                        Text(
                          page.title,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.bold,
                            color: AppColors.textPrimary,
                            height: 1.2,
                          ),
                        ),
                        const SizedBox(height: 14),
                        // Description
                        Text(
                          page.description,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 15,
                            color: Colors.grey[600],
                            height: 1.45,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            // Bottom Controls
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 0, 28, 28),
              child: Column(
                children: [
                  // Dot Indicators
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      _pages.length,
                      (index) => AnimatedContainer(
                        duration: const Duration(milliseconds: 250),
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        height: 8,
                        width: _currentPage == index ? 24 : 8,
                        decoration: BoxDecoration(
                          color: _currentPage == index
                              ? AppColors.primaryGreen
                              : Colors.grey[300],
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),
                  // Action Button
                  if (isLastPage)
                    InfurnusButton(
                      text: 'Get Started',
                      onPressed: _completeOnboarding,
                    )
                  else
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        TextButton(
                          onPressed: () {
                            if (_currentPage > 0) {
                              _pageController.previousPage(
                                duration: const Duration(milliseconds: 300),
                                curve: Curves.easeInOut,
                              );
                            }
                          },
                          child: Text(
                            _currentPage > 0 ? 'Back' : '',
                            style: TextStyle(
                              color: Colors.grey[600],
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        ElevatedButton(
                          onPressed: _nextPage,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primaryGreen,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 28, vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            elevation: 0,
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Next',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                ),
                              ),
                              SizedBox(width: 6),
                              Icon(Icons.arrow_forward_rounded, size: 18),
                            ],
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingPageData {
  final String title;
  final String description;
  final IconData icon;
  final Color accentColor;
  final String badgeText;

  const _OnboardingPageData({
    required this.title,
    required this.description,
    required this.icon,
    required this.accentColor,
    required this.badgeText,
  });
}
