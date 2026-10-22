import 'package:flutter/material.dart';

/// Photo-realistic Auth Hero Banner displaying the original INFURNUS
/// promotional poster asset (`login_hero_banner.jpg`) using BoxFit.contain
/// to ensure 100% of the artwork (heading, tagline, 4 category cards, woman, vehicles)
/// is fully visible without cropping or being hidden.
class AuthHeroBanner extends StatelessWidget {
  const AuthHeroBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.black,
      child: Image.asset(
        'assets/images/login_hero_banner.jpg',
        fit: BoxFit.contain,
        alignment: Alignment.topCenter,
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
        ),
      ),
    );
  }
}
