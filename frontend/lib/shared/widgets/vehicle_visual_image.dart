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

  /// Map vehicle names/categories to correct verified asset paths
  static String? getAssetPath(String? name, String? cat) {
    final key = '${name ?? ''} ${cat ?? ''}'.toLowerCase().trim();

    if (key.contains('bike') ||
        key.contains('two-wheeler') ||
        key.contains('motorcycle')) {
      return 'assets/images/bike_rider_green_white.png';
    }
    if (key.contains('e_rickshaw') ||
        key.contains('e-rickshaw') ||
        (key.contains('rickshaw') && key.contains('electric'))) {
      return 'assets/images/e_rickshaw_green_white.png';
    }
    if (key.contains('auto') || key.contains('rickshaw')) {
      return 'assets/images/auto_green_white.png';
    }
    if (key.contains('thar')) {
      return 'assets/images/thar_visual.webp';
    }
    if (key.contains('scorpio')) {
      return 'assets/images/scorpio_n_white.png';
    }
    if (key.contains('fortuner')) {
      return 'assets/images/fortuner_visual.jpg';
    }
    if (key.contains('suv')) {
      return 'assets/images/scorpio_n_white.png';
    }
    if (key.contains('innova') ||
        key.contains('mercedes') ||
        key.contains('bmw') ||
        key.contains('luxury')) {
      return 'assets/images/bmw_visual.webp';
    }
    if (key.contains('tata magic') || key.contains('magic')) {
      return 'assets/images/tata_magic_cream.png';
    }
    if (key.contains('ape')) {
      return 'assets/images/piaggio_ape_yellow.png';
    }
    if (key.contains('207') &&
        (key.contains('heavy') || key.contains('truck'))) {
      return 'assets/images/cargo_207_heavy.png';
    }
    if (key.contains('207')) {
      return 'assets/images/cargo_207_normal.png';
    }
    if (key.contains('407')) {
      return 'assets/images/tata_407_beige.png';
    }
    if (key.contains('pickup')) {
      return 'assets/images/cargo_207_normal.png';
    }
    if (key.contains('truck') ||
        key.contains('mini truck') ||
        key.contains('logistics')) {
      return 'assets/images/cargo_207_heavy.png';
    }
    if (key.contains('ambulance') || key.contains('emergency')) {
      return 'assets/images/ambulance_visual.jpg';
    }
    if (key.contains('towing')) {
      return 'assets/images/flatbed_towing_truck.png';
    }
    if (key.contains('roadside')) {
      return 'assets/images/towing_van_green.png';
    }
    if (key.contains('traveller') ||
        key.contains('winger') ||
        key.contains('van')) {
      return 'assets/images/force_traveller_van.png';
    }
    if (key.contains('hatchback') || key.contains('compact')) {
      return 'assets/images/hatchback_visual.png';
    }
    if (key.contains('sedan') ||
        key.contains('cab') ||
        key.contains('car') ||
        key.contains('passenger')) {
      return 'assets/images/sedan_green_white.png';
    }

    return 'assets/images/sedan_green_white.png';
  }

  /// Get appropriate fallback icon for vehicle type
  static IconData getFallbackIcon(String? name, String? cat) {
    final key = '${name ?? ''} ${cat ?? ''}'.toLowerCase().trim();

    if (key.contains('bike')) return Icons.two_wheeler_rounded;
    if (key.contains('auto') || key.contains('rickshaw')) {
      return Icons.electric_rickshaw_rounded;
    }
    if (key.contains('truck') || key.contains('cargo') || key.contains('ape')) {
      return Icons.local_shipping_rounded;
    }
    if (key.contains('ambulance')) return Icons.medical_services_rounded;
    if (key.contains('towing') || key.contains('roadside')) {
      return Icons.car_repair_rounded;
    }
    if (key.contains('jcb') ||
        key.contains('crane') ||
        key.contains('excavator')) {
      return Icons.construction_rounded;
    }
    if (key.contains('helicopter')) return Icons.airplanemode_active_rounded;
    if (key.contains('traveller') || key.contains('van')) {
      return Icons.airport_shuttle_rounded;
    }

    return Icons.directions_car_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final resolvedAsset =
        customAssetPath ?? getAssetPath(vehicleName, category);

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
