import 'package:flutter/material.dart';

/// Photo-realistic Auth Hero Banner using the Infurnus promotional image.
/// Rendered inside a Stack layout so the promotional artwork is clearly visible
/// and not compressed.
class AuthHeroBanner extends StatelessWidget {
  const AuthHeroBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: double.infinity,
      child: Image.asset(
        'assets/images/login_hero_banner.jpg',
        fit: BoxFit.cover,
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
