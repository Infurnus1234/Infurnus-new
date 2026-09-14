import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import 'infurnus_card.dart';

class InfurnusVehicleCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final String price;
  final String? imagePath;
  final bool isSelected;
  final VoidCallback? onTap;

  const InfurnusVehicleCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.price,
    this.imagePath,
    this.isSelected = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InfurnusCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Container(
        decoration: BoxDecoration(
          border: isSelected ? Border.all(color: AppColors.primaryGreen, width: 2) : null,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Container(
              width: 60,
              height: 40,
              color: Colors.grey[200], // Placeholder for image
              child: const Icon(Icons.directions_car),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  Text(subtitle, style: const TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
            Text(price, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
      ),
    );
  }
}
