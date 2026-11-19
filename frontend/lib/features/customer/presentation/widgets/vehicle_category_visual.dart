import 'package:flutter/material.dart';

enum VehicleCategoryType {
  rides,
  logistics,
  emergency,
  rental,
  auto,
  bike,
  premium,
}

class VehicleCategoryConfig {
  final VehicleCategoryType category;
  final String title;
  final String subtitle;
  final String? assetImagePath;
  final IconData fallbackIcon;

  const VehicleCategoryConfig({
    required this.category,
    required this.title,
    required this.subtitle,
    this.assetImagePath,
    required this.fallbackIcon,
  });

  static Map<VehicleCategoryType, VehicleCategoryConfig> get registry => const {
    VehicleCategoryType.rides: VehicleCategoryConfig(
      category: VehicleCategoryType.rides,
      title: 'Rides & Cabs',
      subtitle: 'Daily city rides',
      assetImagePath: 'assets/images/hatchback_clean.jpg',
      fallbackIcon: Icons.directions_car_rounded,
    ),
    VehicleCategoryType.logistics: VehicleCategoryConfig(
      category: VehicleCategoryType.logistics,
      title: 'Logistics',
      subtitle: 'Cargo & Trucks',
      assetImagePath: 'assets/images/mini_commercial.jpg',
      fallbackIcon: Icons.local_shipping_rounded,
    ),
    VehicleCategoryType.emergency: VehicleCategoryConfig(
      category: VehicleCategoryType.emergency,
      title: 'Emergency',
      subtitle: 'Ambulance & Tow',
      assetImagePath: 'assets/images/ambulance_clean.jpg',
      fallbackIcon: Icons.medical_services_rounded,
    ),
    VehicleCategoryType.rental: VehicleCategoryConfig(
      category: VehicleCategoryType.rental,
      title: 'Rentals',
      subtitle: 'Chauffeur & Self-drive',
      assetImagePath: 'assets/images/innova_crysta_clean.jpg',
      fallbackIcon: Icons.car_rental_rounded,
    ),
    VehicleCategoryType.auto: VehicleCategoryConfig(
      category: VehicleCategoryType.auto,
      title: 'Auto',
      subtitle: 'Fast 3-wheeler',
      assetImagePath: 'assets/images/auto_rickshaw.png',
      fallbackIcon: Icons.electric_rickshaw_rounded,
    ),
    VehicleCategoryType.bike: VehicleCategoryConfig(
      category: VehicleCategoryType.bike,
      title: 'Bike',
      subtitle: 'Quick 2-wheeler',
      assetImagePath: 'assets/images/bike_motorcycle.png',
      fallbackIcon: Icons.two_wheeler_rounded,
    ),
    VehicleCategoryType.premium: VehicleCategoryConfig(
      category: VehicleCategoryType.premium,
      title: 'Premium SUV',
      subtitle: 'Luxury & Fortuner',
      assetImagePath: 'assets/images/innova_crysta_clean.jpg',
      fallbackIcon: Icons.stars_rounded,
    ),
  };

  static VehicleCategoryConfig getConfig(VehicleCategoryType type) {
    return registry[type] ?? registry[VehicleCategoryType.rides]!;
  }
}

class VehicleCategoryVisual extends StatelessWidget {
  final VehicleCategoryType category;
  final String? customAssetPath;
  final double size;
  final double borderRadius;
  final BoxFit fit;

  const VehicleCategoryVisual({
    super.key,
    required this.category,
    this.customAssetPath,
    this.size = 48,
    this.borderRadius = 12,
    this.fit = BoxFit.contain,
  });

  /// Returns true when the asset path is a black-background vehicle PNG
  /// (assets/vehicles/ folder) so we can adapt the container colour.
  static bool _hasBlackBg(String? path) =>
      path != null && path.startsWith('assets/vehicles/');

  @override
  Widget build(BuildContext context) {
    final config = VehicleCategoryConfig.getConfig(category);
    final imagePath = customAssetPath ?? config.assetImagePath;
    final blackBg = _hasBlackBg(imagePath);

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: blackBg ? Colors.black : Colors.white,
          borderRadius: BorderRadius.circular(borderRadius),
        ),
        child: imagePath != null
            ? Image.asset(
                imagePath,
                width: size,
                height: size,
                fit: blackBg ? BoxFit.cover : fit,
                errorBuilder: (_, __, ___) => _buildFallback(config),
              )
            : _buildFallback(config),
      ),
    );
  }

  Widget _buildFallback(VehicleCategoryConfig config) {
    return Icon(
      config.fallbackIcon,
      size: size * 0.55,
      color: const Color(0xFF111827),
    );
  }
}
