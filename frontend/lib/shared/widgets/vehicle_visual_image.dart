import 'package:flutter/material.dart';

class VehicleVisualImage extends StatelessWidget {
  final String? vehicleName;
  final String? category;
  final String? customAssetPath;
  final String? imageUrl;
  final double width;
  final double height;
  final double borderRadius;
  final BoxFit fit;

  const VehicleVisualImage({
    super.key,
    this.vehicleName,
    this.category,
    this.customAssetPath,
    this.imageUrl,
    this.width = 64,
    this.height = 48,
    this.borderRadius = 10,
    this.fit = BoxFit.contain,
  });

  /// Map vehicle names/categories to existing verified asset paths
  static String? getAssetPath(String? name, String? cat) {
    final key = '${name ?? ''} ${cat ?? ''}'.toLowerCase().trim();

    if (key.contains('bike') || key.contains('two-wheeler') || key.contains('motorcycle')) {
      return 'assets/images/bike_visual.jpg';
    }
    if (key.contains('auto') || key.contains('e-rickshaw') || key.contains('rickshaw') || key.contains('ape')) {
      return 'assets/images/auto_visual.jpg';
    }
    if (key.contains('thar')) {
      return 'assets/images/thar_visual.webp';
    }
    if (key.contains('fortuner') || key.contains('scorpio')) {
      return 'assets/images/fortuner_visual.jpg';
    }
    if (key.contains('innova') || key.contains('mercedes') || key.contains('bmw') || key.contains('luxury')) {
      return 'assets/images/bmw_visual.webp';
    }
    if (key.contains('207') || key.contains('407') || key.contains('tata magic') || key.contains('cargo') || key.contains('pickup')) {
      return 'assets/images/tata_pickup_207_407.png';
    }
    if (key.contains('truck') || key.contains('mini truck') || key.contains('logistics')) {
      return 'assets/images/logistics_visual.jpg';
    }
    if (key.contains('ambulance') || key.contains('emergency') || key.contains('roadside')) {
      return 'assets/images/ambulance_visual.jpg';
    }
    if (key.contains('traveller') || key.contains('van') || key.contains('rental')) {
      return 'assets/images/rental_visual.jpg';
    }
    if (key.contains('helicopter') || key.contains('concierge') || key.contains('banner')) {
      return 'assets/images/vehicle_fleet_banner.png';
    }
    if (key.contains('hatchback') || key.contains('sedan') || key.contains('cab') || key.contains('car') || key.contains('passenger')) {
      return 'assets/images/passenger_car_visual.jpg';
    }

    return 'assets/images/passenger_car_visual.jpg';
  }

  /// Get appropriate fallback icon for vehicle type
  static IconData getFallbackIcon(String? name, String? cat) {
    final key = '${name ?? ''} ${cat ?? ''}'.toLowerCase().trim();

    if (key.contains('bike')) return Icons.two_wheeler_rounded;
    if (key.contains('auto') || key.contains('rickshaw')) return Icons.electric_rickshaw_rounded;
    if (key.contains('truck') || key.contains('cargo') || key.contains('ape')) return Icons.local_shipping_rounded;
    if (key.contains('ambulance')) return Icons.medical_services_rounded;
    if (key.contains('towing') || key.contains('roadside')) return Icons.car_repair_rounded;
    if (key.contains('jcb') || key.contains('crane') || key.contains('excavator')) return Icons.construction_rounded;
    if (key.contains('helicopter')) return Icons.airplanemode_active_rounded;
    if (key.contains('traveller') || key.contains('van')) return Icons.airport_shuttle_rounded;

    return Icons.directions_car_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final resolvedAsset = customAssetPath ?? getAssetPath(vehicleName, category);

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: Container(
        width: width,
        height: height,
        color: const Color(0xFFF3F4F6),
        child: _buildImageWidget(resolvedAsset),
      ),
    );
  }

  Widget _buildImageWidget(String? assetPath) {
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      return Image.network(
        imageUrl!,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (_, __, ___) => _buildAssetOrFallback(assetPath),
      );
    }

    return _buildAssetOrFallback(assetPath);
  }

  Widget _buildAssetOrFallback(String? assetPath) {
    if (assetPath != null && assetPath.isNotEmpty) {
      return Image.asset(
        assetPath,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (_, __, ___) => _buildFallbackIconWidget(),
      );
    }

    return _buildFallbackIconWidget();
  }

  Widget _buildFallbackIconWidget() {
    final iconData = getFallbackIcon(vehicleName, category);
    return Center(
      child: Icon(
        iconData,
        size: height * 0.55,
        color: const Color(0xFF111827),
      ),
    );
  }
}
