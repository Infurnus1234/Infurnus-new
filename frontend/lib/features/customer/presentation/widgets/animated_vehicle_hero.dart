import 'package:flutter/material.dart';

/// Reusable animated vehicle component for the Customer Home screen.
/// Designed for smooth visual presentation with a gentle floating/breathing animation.
/// When the stakeholder provides the final 3D/rendered vehicle illustration,
/// simply pass [assetImagePath] or [imageUrl] to replace the placeholder
/// without altering any screen layout logic.
class AnimatedVehicleHero extends StatefulWidget {
  final String? assetImagePath;
  final String? imageUrl;
  final double height;
  final VoidCallback? onTap;

  const AnimatedVehicleHero({
    super.key,
    this.assetImagePath,
    this.imageUrl,
    this.height = 110,
    this.onTap,
  });

  @override
  State<AnimatedVehicleHero> createState() => _AnimatedVehicleHeroState();
}

class _AnimatedVehicleHeroState extends State<AnimatedVehicleHero>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _floatAnimation;
  late final Animation<double> _shadowAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat(reverse: true);

    _floatAnimation = Tween<double>(begin: 0.0, end: -6.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );

    _shadowAnimation = Tween<double>(begin: 0.85, end: 1.15).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onTap,
      child: SizedBox(
        height: widget.height,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            return Stack(
              alignment: Alignment.center,
              children: [
                // Ground Contact Shadow that scales subtly as the car floats
                Positioned(
                  bottom: 4,
                  child: Transform.scale(
                    scaleX: _shadowAnimation.value,
                    scaleY: 0.8,
                    child: Container(
                      width: 120,
                      height: 12,
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(100),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.15),
                            blurRadius: 10,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // Floating Vehicle Body Container
                Transform.translate(
                  offset: Offset(0, _floatAnimation.value),
                  child: _buildVehicleVisual(context),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildVehicleVisual(BuildContext context) {
    if (widget.assetImagePath != null && widget.assetImagePath!.isNotEmpty) {
      return Image.asset(
        widget.assetImagePath!,
        height: widget.height - 16,
        fit: BoxFit.contain,
      );
    }

    if (widget.imageUrl != null && widget.imageUrl!.isNotEmpty) {
      return Image.network(
        widget.imageUrl!,
        height: widget.height - 16,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => _buildPlaceholder(),
      );
    }

    return _buildPlaceholder();
  }

  Widget _buildPlaceholder() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.25),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.20),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.electric_car_rounded,
              size: 32,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 10),
          const Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'INFURNUS FLEET',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                  color: Colors.white,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'Active & Ready',
                style: TextStyle(
                  fontSize: 10,
                  color: Colors.white70,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
