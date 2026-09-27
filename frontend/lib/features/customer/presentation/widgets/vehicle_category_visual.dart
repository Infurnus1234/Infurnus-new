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
          assetImagePath: 'assets/images/passenger_car_visual.jpg',
          fallbackIcon: Icons.directions_car_rounded,
        ),
        VehicleCategoryType.logistics: VehicleCategoryConfig(
          category: VehicleCategoryType.logistics,
          title: 'Logistics',
          subtitle: 'Cargo & Trucks',
          assetImagePath: 'assets/images/logistics_visual.jpg',
          fallbackIcon: Icons.local_shipping_rounded,
        ),
        VehicleCategoryType.emergency: VehicleCategoryConfig(
          category: VehicleCategoryType.emergency,
          title: 'Emergency',
          subtitle: 'Ambulance & Tow',
          assetImagePath: 'assets/images/ambulance_visual.jpg',
          fallbackIcon: Icons.medical_services_rounded,
        ),
        VehicleCategoryType.rental: VehicleCategoryConfig(
          category: VehicleCategoryType.rental,
          title: 'Rentals',
          subtitle: 'Chauffeur & Self-drive',
          assetImagePath: 'assets/images/rental_visual.jpg',
          fallbackIcon: Icons.car_rental_rounded,
        ),
        VehicleCategoryType.auto: VehicleCategoryConfig(
          category: VehicleCategoryType.auto,
          title: 'Auto',
          subtitle: 'Fast 3-wheeler',
          assetImagePath: 'assets/images/auto_visual.jpg',
          fallbackIcon: Icons.electric_rickshaw_rounded,
        ),
        VehicleCategoryType.bike: VehicleCategoryConfig(
          category: VehicleCategoryType.bike,
          title: 'Bike',
          subtitle: 'Quick 2-wheeler',
          assetImagePath: 'assets/images/bike_visual.jpg',
          fallbackIcon: Icons.two_wheeler_rounded,
        ),
        VehicleCategoryType.premium: VehicleCategoryConfig(
          category: VehicleCategoryType.premium,
          title: 'Premium SUV',
          subtitle: 'Luxury & Fortuner',
          assetImagePath: 'assets/images/vehicle_fleet_banner.png',
          fallbackIcon: Icons.stars_rounded,
        ),
      };

  static VehicleCategoryConfig getConfig(VehicleCategoryType type) {
    return registry[type] ?? registry[VehicleCategoryType.rides]!;
  }
}

class VehicleCategoryVisual extends StatelessWidget {
  final VehicleCategoryType category;
  final double size;
  final double borderRadius;
  final BoxFit fit;

  const VehicleCategoryVisual({
    super.key,
    required this.category,
    this.size = 48,
    this.borderRadius = 12,
    this.fit = BoxFit.cover,
  });

  @override
  Widget build(BuildContext context) {
    final config = VehicleCategoryConfig.getConfig(category);

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: const Color(0xFFF3F4F6),
          borderRadius: BorderRadius.circular(borderRadius),
        ),
        child: config.assetImagePath != null
            ? Image.asset(
                config.assetImagePath!,
                width: size,
                height: size,
                fit: fit,
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
