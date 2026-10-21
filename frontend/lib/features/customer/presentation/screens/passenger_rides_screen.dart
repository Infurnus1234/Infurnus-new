import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/ride_provider.dart';

class PassengerRidesScreen extends ConsumerStatefulWidget {
  const PassengerRidesScreen({super.key});

  @override
  ConsumerState<PassengerRidesScreen> createState() =>
      _PassengerRidesScreenState();
}

class _PassengerRidesScreenState extends ConsumerState<PassengerRidesScreen> {
  String _selectedFilter = 'All';

  final List<String> _filters = ['All', 'Bike', 'Auto', 'E-Rickshaw', 'Car'];

  final List<Map<String, dynamic>> _allVehicles = [
    {
      'title': 'Bike',
      'category': 'bike',
      'filter': 'Bike',
      'subtitle': '1 rider • Fast & affordable',
      'capacity': '1 rider',
      'price': 'Route estimate',
      'image': 'assets/images/bike_motorcycle.png',
      'fallbackIcon': Icons.two_wheeler_rounded,
    },
    {
      'title': 'Auto',
      'category': 'auto',
      'filter': 'Auto',
      'subtitle': '3 seater • Everyday travel',
      'capacity': '3 seats',
      'price': 'Route estimate',
      'image': 'assets/images/auto_rickshaw.png',
      'fallbackIcon': Icons.electric_rickshaw_rounded,
    },
    {
      'title': 'E-Rickshaw',
      'category': 'e-rickshaw',
      'filter': 'E-Rickshaw',
      'subtitle': '4 seater • Eco-friendly',
      'capacity': '4 seats',
      'price': 'Route estimate',
      'image': 'assets/images/e_rickshaw_passenger.png',
      'fallbackIcon': Icons.electric_rickshaw_rounded,
    },
    {
      'title': 'Hatchback',
      'category': 'hatchback',
      'filter': 'Car',
      'subtitle': '4 seater • Compact & comfortable',
      'capacity': '4 seats',
      'price': 'Route estimate',
      'image': 'assets/images/hatchback.jpg',
      'fallbackIcon': Icons.directions_car_filled_rounded,
    },
    {
      'title': 'Sedan',
      'category': 'sedan',
      'filter': 'Car',
      'subtitle': '4 seater • Premium comfort',
      'capacity': '4 seats',
      'price': 'Route estimate',
      'image': 'assets/images/sedan.jpg',
      'fallbackIcon': Icons.directions_car_rounded,
    },
    {
      'title': 'Innova Crysta',
      'category': 'innova',
      'filter': 'Car',
      'subtitle': '6-7 seater • Spacious & luxurious',
      'capacity': '6-7 seats',
      'price': 'Route estimate',
      'image': 'assets/images/innova_crysta.jpg',
      'fallbackIcon': Icons.directions_car_filled_rounded,
    },
    {
      'title': 'Winger',
      'category': 'winger',
      'filter': 'Car',
      'subtitle': '9-12 seater • Executive group transit',
      'capacity': '9-12 seats',
      'price': 'Route estimate',
      'image': 'assets/images/winger.jpg',
      'fallbackIcon': Icons.directions_bus_rounded,
    },
    {
      'title': 'Force Traveller',
      'category': 'traveller',
      'filter': 'Car',
      'subtitle': '12 seater • Group travel',
      'capacity': '12 seats',
      'price': 'Route estimate',
      'image': 'assets/images/force_urbania.jpg',
      'fallbackIcon': Icons.airport_shuttle_rounded,
    },
    {
      'title': 'Mini / Commercial',
      'category': 'mini_commercial',
      'filter': 'Car',
      'subtitle': '3-4 seater • City passenger commercial',
      'capacity': '3-4 seats',
      'price': 'Route estimate',
      'image': 'assets/images/mini_commercial.jpg',
      'fallbackIcon': Icons.local_shipping_outlined,
    },
  ];

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final selectedTier = rideState.selectedTier.isEmpty ? 'auto' : rideState.selectedTier;

    final filteredVehicles = _selectedFilter == 'All'
        ? _allVehicles
        : _allVehicles.where((v) => v['filter'] == _selectedFilter).toList();

    final selectedVehicle = _allVehicles.firstWhere(
      (v) => v['category'] == selectedTier,
      orElse: () => _allVehicles[1],
    );

    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: Color(0xFF111827)),
          onPressed: () => context.pop(),
        ),
        title: const Text(
          'Passenger Rides',
          style: TextStyle(
            color: Color(0xFF111827),
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: Column(
        children: [
          // Filter Chips Horizontal Row
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: SizedBox(
              height: 36,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _filters.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final filter = _filters[index];
                  final isSelected = filter == _selectedFilter;
                  return GestureDetector(
                    onTap: () => setState(() => _selectedFilter = filter),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? const Color(0xFF16A34A)
                            : Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: isSelected
                              ? const Color(0xFF16A34A)
                              : const Color(0xFFE5E7EB),
                        ),
                      ),
                      child: Center(
                        child: Text(
                          filter,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: isSelected
                                ? Colors.white
                                : const Color(0xFF374151),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          const Divider(height: 1, color: Color(0xFFE5E7EB)),

          // Vehicle List Cards
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              itemCount: filteredVehicles.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (context, index) {
                final vehicle = filteredVehicles[index];
                final isSelected = selectedTier == vehicle['category'];

                return GestureDetector(
                  onTap: () {
                    ref.read(rideProvider.notifier).selectSector('passenger');
                    ref
                        .read(rideProvider.notifier)
                        .selectTier(vehicle['category']);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 14,
                    ),
                    decoration: BoxDecoration(
                      color: isSelected ? const Color(0xFFF0FDF4) : Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: isSelected ? const Color(0xFF16A34A) : const Color(0xFFE5E7EB),
                        width: isSelected ? 1.8 : 1,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: isSelected
                              ? const Color(0xFF16A34A).withValues(alpha: 0.12)
                              : Colors.black.withValues(alpha: 0.03),
                          blurRadius: isSelected ? 10 : 6,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        // Vehicle Image Thumbnail
                        Container(
                          width: 64,
                          height: 52,
                          decoration: BoxDecoration(
                            color: const Color(0xFFF3F4F6),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Image.asset(
                              vehicle['image'],
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) => Icon(
                                vehicle['fallbackIcon'] as IconData,
                                size: 28,
                                color: const Color(0xFF16A34A),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 14),

                        // Title & Subtitle
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      vehicle['title'],
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.bold,
                                        color: isSelected ? const Color(0xFF15803D) : const Color(0xFF111827),
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  if (isSelected) ...[
                                    const SizedBox(width: 8),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF16A34A),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: const Text(
                                        'Selected',
                                        style: TextStyle(
                                          fontSize: 9.5,
                                          fontWeight: FontWeight.bold,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 3),
                              Text(
                                vehicle['subtitle'],
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B7280),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),

                        // Price and Selection / Chevron
                        ConstrainedBox(
                          constraints: const BoxConstraints(minWidth: 70, maxWidth: 95),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerRight,
                                child: Text(
                                  isSelected && rideState.fareEstimate != null
                                      ? rideState.fareEstimate!.displayFare
                                      : (vehicle['price'] as String),
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w800,
                                    color: isSelected ? const Color(0xFF16A34A) : const Color(0xFF111827),
                                    letterSpacing: -0.2,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Icon(
                                isSelected ? Icons.check_circle_rounded : Icons.chevron_right_rounded,
                                size: 20,
                                color: isSelected ? const Color(0xFF16A34A) : const Color(0xFF9CA3AF),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),

          // Bottom Action Bar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black12,
                  blurRadius: 10,
                  offset: Offset(0, -2),
                ),
              ],
            ),
            child: SafeArea(
              child: SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF16A34A),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(26),
                    ),
                    elevation: 0,
                  ),
                  onPressed: () {
                    ref.read(rideProvider.notifier).selectSector('passenger');
                    ref.read(rideProvider.notifier).selectTier(selectedVehicle['category']);
                    context.push('/ride-booking');
                  },
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        rideState.fareEstimate != null
                            ? 'Book ${selectedVehicle['title']} • ${rideState.fareEstimate!.displayFare}'
                            : 'Select ${selectedVehicle['title']} & Set Route',
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Icon(Icons.arrow_forward_rounded, size: 18, color: Colors.white),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
