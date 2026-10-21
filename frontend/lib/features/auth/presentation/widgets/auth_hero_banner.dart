import 'package:flutter/material.dart';

/// Photo-realistic Auth Hero Banner using the Infurnus promotional image.
/// Matches the reference login screen design with the full promotional artwork.
class AuthHeroBanner extends StatelessWidget {
  const AuthHeroBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // Hero takes ~60% of screen height
        final screenHeight = MediaQuery.of(context).size.height;
        final heroHeight = screenHeight * 0.60;

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
          // Ambient Neon Glow
          Positioned(
            top: -50,
            right: -50,
            child: Container(
              width: 250,
              height: 250,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    const Color(0xFF00E676).withValues(alpha: 0.22),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12.0),
              child: Column(
                children: [
                  const SizedBox(height: 8),
                  Image.asset(
                    'assets/images/infurnus_3d_logo.png',
                    height: 52,
                    fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => const Text(
                      'INFURNUS',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 2.5,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Your All-in-One Mobility Partner',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _Bullet('Ride'),
                      _Dot(),
                      _Bullet('Logistics'),
                      _Dot(),
                      _Bullet('Premium Ride'),
                      _Dot(),
                      _Bullet('Service Vehicles'),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 140,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      children: const [
                        _ServiceCard(
                          title: 'Ride',
                          subtitle: 'Daily rides\nfor every need',
                          footer: 'Hatchback • Sedan\nSUV • Bike • Auto',
                          icon: Icons.directions_car_rounded,
                          accent: Color(0xFF00E676),
                          bg: [Color(0xFF022B14), Color(0xFF011A0C)],
                          border: Color(0x6600E676),
                        ),
                        SizedBox(width: 10),
                        _ServiceCard(
                          title: 'Logistics',
                          subtitle: 'Deliver anything\nanywhere',
                          footer: 'Bike • Van • Mini Truck\nTruck • Courier',
                          icon: Icons.inventory_2_rounded,
                          accent: Color(0xFFFFB300),
                          bg: [Color(0xFF2E1A00), Color(0xFF1F1000)],
                          border: Color(0x66FFB300),
                        ),
                        SizedBox(width: 10),
                        _ServiceCard(
                          title: 'Premium Ride',
                          subtitle: 'Travel in style\nand comfort',
                          footer: 'Premium Sedan\nSUV • Luxury Cars',
                          icon: Icons.workspace_premium_rounded,
                          accent: Color(0xFFB388FF),
                          bg: [Color(0xFF20003B), Color(0xFF140026)],
                          border: Color(0x66B388FF),
                        ),
                        SizedBox(width: 10),
                        _ServiceCard(
                          title: 'Service Vehicles',
                          subtitle: 'On-demand vehicles\nfor your work',
                          footer: 'Pickup • Mini Truck\nTruck • Crane • Tow\nJCB • Service Van',
                          icon: Icons.build_rounded,
                          accent: Color(0xFF40C4FF),
                          bg: [Color(0xFF001D38), Color(0xFF001224)],
                          border: Color(0x6640C4FF),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _ValueBadge(icon: '⚡', label: 'Fast\nBooking'),
                        _ValueBadge(icon: '🛡️', label: 'Safe &\nReliable'),
                        _ValueBadge(icon: '₹', label: 'Affordable\nPricing'),
                        _ValueBadge(icon: '🎧', label: '24/7\nSupport'),
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
}

class _Bullet extends StatelessWidget {
  final String text;
  const _Bullet(this.text);
  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: Color(0xFF00E676),
        ),
      );
}

class _Dot extends StatelessWidget {
  const _Dot();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(horizontal: 5),
        child: Text('•',
            style: TextStyle(
                color: Color(0xFF00E676),
                fontSize: 10,
                fontWeight: FontWeight.bold)),
      );
}

class _ServiceCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final String footer;
  final IconData icon;
  final Color accent;
  final List<Color> bg;
  final Color border;

  const _ServiceCard({
    required this.title,
    required this.subtitle,
    required this.footer,
    required this.icon,
    required this.accent,
    required this.bg,
    required this.border,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 118,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: bg,
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border, width: 1.2),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.15),
            blurRadius: 10,
            spreadRadius: 1,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(5),
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: accent, size: 18),
          ),
          const SizedBox(height: 6),
          Text(title,
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                  color: Colors.white)),
          const SizedBox(height: 2),
          Text(subtitle,
              style: const TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFFE0E0E0),
                  height: 1.1)),
          const Spacer(),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(footer,
                style: TextStyle(
                    fontSize: 7.5,
                    fontWeight: FontWeight.w600,
                    color: accent,
                    height: 1.1)),
          ),
        ],
      ),
    );
  }
}

class _ValueBadge extends StatelessWidget {
  final String icon;
  final String label;
  const _ValueBadge({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: const Color(0xFF022B14),
            border:
                Border.all(color: const Color(0xFF00E676), width: 1.2),
            boxShadow: const [
              BoxShadow(
                  color: Color(0x3300E676), blurRadius: 6),
            ],
          ),
          child: Center(
              child:
                  Text(icon, style: const TextStyle(fontSize: 16))),
        ),
        const SizedBox(height: 4),
        Text(label,
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
                color: Colors.white,
                height: 1.1)),
      ],
    );
  }
}
