import 'package:flutter/material.dart';

import '../../features/customer/data/models/route_model.dart';

class RouteDistanceSummary extends StatelessWidget {
  final RouteModel route;
  const RouteDistanceSummary({super.key, required this.route});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          'Road distance: ${(route.distanceMeters / 1000).toStringAsFixed(1)} km',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        Text(
          '~${(route.durationSeconds / 60).ceil()} mins',
          style: const TextStyle(color: Colors.white),
        ),
      ],
    ),
  );
}
