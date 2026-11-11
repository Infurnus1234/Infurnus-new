import 'package:flutter/material.dart';

import '../../data/models/ride_model.dart';

const _ink = Color(0xFF111827),
    _muted = Color(0xFF4B5563),
    _green = Color(0xFF16A34A);

/// The heading takes the remaining width instead of measuring itself unbounded.
class DriverMatchedHeader extends StatelessWidget {
  final String title;
  const DriverMatchedHeader({super.key, required this.title});
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final heading = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: _ink,
            ),
          ),
          const Text(
            'ETA: ~3 mins away',
            style: TextStyle(
              color: _green,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ],
      );
      final badge = Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: _green.withValues(alpha: .15),
          borderRadius: BorderRadius.circular(6),
        ),
        child: const Text(
          'MATCHED',
          style: TextStyle(
            color: _green,
            fontWeight: FontWeight.bold,
            fontSize: 11,
          ),
        ),
      );
      if (constraints.maxWidth < 280 ||
          MediaQuery.textScalerOf(context).scale(16) > 24) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [heading, const SizedBox(height: 8), badge],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: heading),
          const SizedBox(width: 12),
          badge,
        ],
      );
    },
  );
}

class AssignedDriverSummary extends StatelessWidget {
  final RideModel? ride;
  final String? fallbackName, fallbackVehicle;
  final VoidCallback onCall;
  const AssignedDriverSummary({
    super.key,
    this.ride,
    this.fallbackName,
    this.fallbackVehicle,
    required this.onCall,
  });
  @override
  Widget build(BuildContext context) {
    final driver = ride?.driverDetails, vehicle = ride?.vehicleDetails;
    final photo = Uri.tryParse(driver?.photoUrl ?? '');
    const fallback = Icon(Icons.person_rounded, color: _green, size: 28);
    final avatar = SizedBox.square(
      dimension: 52,
      child: ClipOval(
        child: ColoredBox(
          color: _green.withValues(alpha: .1),
          child:
              photo != null &&
                  ['https', 'http'].contains(photo.scheme) &&
                  photo.host.isNotEmpty
              ? Image.network(
                  photo.toString(),
                  fit: BoxFit.cover,
                  width: 52,
                  height: 52,
                  errorBuilder: (_, _, _) => fallback,
                )
              : fallback,
        ),
      ),
    );
    final details = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          driver?.name.isNotEmpty == true
              ? driver!.name
              : (fallbackName ??
                    'Matching driver details from fleet server...'),
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 16,
            color: _ink,
          ),
        ),
        if (ride?.bookingId != null)
          Text(
            'Booking ID: ${ride!.bookingId}',
            style: const TextStyle(color: _muted, fontSize: 12),
          ),
        const SizedBox(height: 2),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              driver?.rating != null
                  ? Icons.star_rounded
                  : Icons.verified_rounded,
              color: driver?.rating != null ? const Color(0xFFCA8A04) : _green,
              size: 14,
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                driver?.rating != null
                    ? '${driver!.rating!.toStringAsFixed(1)} • Verified Driver'
                    : 'Verified Driver',
                style: const TextStyle(color: _muted, fontSize: 12),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          vehicle != null && vehicle.make.isNotEmpty
              ? '${vehicle.make} ${vehicle.model} • ${vehicle.plateNumber}'
              : (fallbackVehicle ??
                    'Vehicle details pending assignment from fleet...'),
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 12,
            color: _ink,
          ),
        ),
      ],
    );
    final call = IconButton(
      tooltip: 'Call driver',
      icon: const Icon(Icons.phone_rounded, color: _green),
      onPressed: onCall,
    );
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 240 ||
              MediaQuery.textScalerOf(context).scale(16) > 24) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [avatar, const Spacer(), call]),
                const SizedBox(height: 10),
                details,
              ],
            );
          }
          return Row(
            children: [
              avatar,
              const SizedBox(width: 12),
              Expanded(child: details),
              call,
            ],
          );
        },
      ),
    );
  }
}

class RidePickupPin extends StatelessWidget {
  final String pin;
  final String label;
  const RidePickupPin({
    super.key,
    required this.pin,
    this.label = 'Pickup PIN (share with driver):',
  });
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xFFE5E7EB)),
    ),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(color: _muted, fontSize: 13),
          ),
        ),
        const SizedBox(width: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
          decoration: BoxDecoration(
            color: _green,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            pin,
            style: const TextStyle(
              color: Colors.black,
              fontWeight: FontWeight.bold,
              fontSize: 16,
              letterSpacing: 2,
            ),
          ),
        ),
      ],
    ),
  );
}

class RideDeliveryPin extends StatelessWidget {
  final String pin;
  final String label;
  const RideDeliveryPin({
    super.key,
    required this.pin,
    this.label = 'Delivery/End OTP (share at delivery):',
  });
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xFFE5E7EB)),
    ),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(color: _muted, fontSize: 13),
          ),
        ),
        const SizedBox(width: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
          decoration: BoxDecoration(
            color: const Color(0xFF2563EB),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            pin,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 16,
              letterSpacing: 2,
            ),
          ),
        ),
      ],
    ),
  );
}
