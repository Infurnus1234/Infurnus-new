import 'package:flutter/material.dart';

/// Photo-realistic Auth Hero Banner displaying the original INFURNUS
/// promotional poster asset (`login_hero_banner.jpg`) using BoxFit.contain
/// to ensure 100% of the artwork (INFURNUS title, phone mockup, all four service cards,
/// woman, vehicles and bottom feature labels) is fully visible without cropping or being hidden.
class AuthHeroBanner extends StatelessWidget {
  const AuthHeroBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.hasBoundedHeight
            ? constraints.maxHeight
            : (MediaQuery.sizeOf(context).height * 0.58).clamp(340.0, 560.0);
        return Container(
          height: height,
          width: double.infinity,
          color: Colors.black,
          alignment: Alignment.topCenter,
          child: Image.asset(
            'assets/images/login_hero_banner.jpg',
            fit: BoxFit.contain,
            alignment: Alignment.topCenter,
            width: double.infinity,
            height: double.infinity,
            errorBuilder: (_, __, ___) => Container(
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
                ),
              ),
              child: Center(
                child: Image.asset(
                  'assets/images/infurnus_3d_logo.png',
                  height: 48,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const Text(
                    'INFURNUS',
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2.5,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
