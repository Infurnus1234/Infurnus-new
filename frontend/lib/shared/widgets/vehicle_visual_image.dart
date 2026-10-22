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
      return 'assets/images/bike_motorcycle.png';
    }
    if (key.contains('electric tuk') ||
        key.contains('tuk-tuk') ||
        key.contains('tuk tuk')) {
      return 'assets/images/e_rickshaw_passenger.png';
    }
    if (key.contains('e_rickshaw') ||
        key.contains('e-rickshaw') ||
        (key.contains('rickshaw') && key.contains('electric'))) {
      return 'assets/images/e_rickshaw_green_white.png';
    }
    if (key.contains('auto') || key.contains('rickshaw')) {
      return 'assets/images/auto_rickshaw.png';
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
    if (key.contains('innova')) {
      return 'assets/images/innova_crysta.jpg';
    }
    if (key.contains('mercedes') ||
        key.contains('bmw') ||
        key.contains('luxury')) {
      return 'assets/images/bmw_visual.webp';
    }
    if (key.contains('jcb') || key.contains('excavator')) {
      return 'assets/images/jcb_excavator.jpg';
    }
    if (key.contains('roller') || key.contains('road roller')) {
      return 'assets/images/road_roller.jpg';
    }
    if (key.contains('crane')) {
      return 'assets/images/crane_truck.png';
    }
    if (key.contains('garbage') || key.contains('dump')) {
      return 'assets/images/garbage_dump_truck.png';
    }
    if (key.contains('towing') ||
        key.contains('roadside') ||
        key.contains('tow')) {
      return 'assets/images/towing_van.jpg';
    }
    if (key.contains('mini truck') || key.contains('mini_truck')) {
      return 'assets/images/mini_truck.jpg';
    }
    if (key.contains('407')) {
      return 'assets/images/cargo_407.jpg';
    }
    if (key.contains('mini / commercial') ||
        key.contains('mini commercial') ||
        key.contains('commercial') ||
        key.contains('ape')) {
      return 'assets/images/mini_commercial.jpg';
    }
    if (key.contains('sedan')) {
      return 'assets/images/sedan.jpg';
    }
    if (key.contains('tata magic') || key.contains('magic')) {
      return 'assets/images/tata_magic_cream.png';
    }
    if (key.contains('207') &&
        (key.contains('heavy') || key.contains('truck'))) {
      return 'assets/images/cargo_207_heavy.png';
    }
    if (key.contains('207')) {
      return 'assets/images/cargo_207_normal.png';
    }
    if (key.contains('pickup')) {
      return 'assets/images/cargo_407.jpg';
    }
    if (key.contains('truck') || key.contains('logistics')) {
      return 'assets/images/mini_truck.jpg';
    }
    if (key.contains('ambulance') || key.contains('emergency')) {
      return 'assets/images/ambulance_van.png';
    }
    if (key.contains('winger')) {
      return 'assets/images/winger.jpg';
    }
    if (key.contains('traveller') ||
        key.contains('urbania') ||
        key.contains('van')) {
      return 'assets/images/force_urbania.jpg';
    }
    if (key.contains('hatchback') ||
        key.contains('compact') ||
        key.contains('baleno')) {
      return 'assets/images/hatchback.jpg';
    }
    if (key.contains('suv')) {
      return 'assets/images/scorpio_n_white.png';
    }
    if (key.contains('cab') ||
        key.contains('car') ||
        key.contains('passenger')) {
      return 'assets/images/sedan.jpg';
    }

    return 'assets/images/sedan.jpg';
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
        key.contains('excavator') ||
        key.contains('roller')) {
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
