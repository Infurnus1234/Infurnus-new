import 'package:flutter/material.dart';

/// Photo-realistic Auth Hero Banner using the Infurnus promotional image.
/// Uses BoxFit.cover with top alignment to fill the full available screen width
/// without black side margins while keeping the artwork prominent.
class AuthHeroBanner extends StatelessWidget {
  const AuthHeroBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final heroHeight = constraints.maxHeight;

        return SizedBox(
          width: double.infinity,
          height: heroHeight,
          child: Image.asset(
            'assets/images/login_hero_banner.jpg',
            fit: BoxFit.cover,
            alignment: Alignment.topCenter,
            errorBuilder: (_, __, ___) => _FallbackHeroBanner(height: heroHeight),
          ),
        );
      },
    );
  }
}

/// Fallback widget-based banner in case the image asset fails to load.
class _FallbackHeroBanner extends StatelessWidget {
  final double height;
  const _FallbackHeroBanner({required this.height});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Color(0xFF01180B),
            Color(0xFF00220F),
            Color(0xFF000D05),
            Color(0xFF000000),
          ],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: [0.0, 0.35, 0.75, 1.0],
        ),
      ),
      child: Stack(
        children: [
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text(
                    'INFURNUS',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2.5,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Your All-in-One Mobility Partner',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF00E676),
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
}
