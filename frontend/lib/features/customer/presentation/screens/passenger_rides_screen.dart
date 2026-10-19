import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/ride_provider.dart';

class PassengerRidesScreen extends ConsumerStatefulWidget {
  const PassengerRidesScreen({super.key});

  @override
  ConsumerState<PassengerRidesScreen> createState() => _PassengerRidesScreenState();
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
      'price': '₹35-60',
      'image': 'assets/images/bike_rider_green_white.png',
      'fallbackIcon': Icons.two_wheeler_rounded,
    },
    {
      'title': 'Auto',
      'category': 'auto',
      'filter': 'Auto',
      'subtitle': '3 seater • Everyday travel',
      'price': '₹60-100',
      'image': 'assets/images/auto_green_white.png',
      'fallbackIcon': Icons.electric_rickshaw_rounded,
    },
    {
      'title': 'E-Rickshaw',
      'category': 'e-rickshaw',
      'filter': 'E-Rickshaw',
      'subtitle': '4 seater • Eco-friendly',
      'price': '₹50-90',
      'image': 'assets/images/e_rickshaw_green_white.png',
      'fallbackIcon': Icons.electric_rickshaw_rounded,
    },
    {
      'title': 'Hatchback',
      'category': 'hatchback',
      'filter': 'Car',
      'subtitle': '4 seater • Compact & comfortable',
      'price': '₹120-180',
      'image': 'assets/images/passenger_car_visual.jpg',
      'fallbackIcon': Icons.directions_car_filled_rounded,
    },
    {
      'title': 'Sedan',
      'category': 'sedan',
      'filter': 'Car',
      'subtitle': '4 seater • Premium comfort',
      'price': '₹150-220',
      'image': 'assets/images/sedan_green_white.png',
      'fallbackIcon': Icons.directions_car_rounded,
    },
    {
      'title': 'SUV / Scorpio N',
      'category': 'suv',
      'filter': 'Car',
      'subtitle': '6-7 seater • Spacious & powerful',
      'price': '₹200-350',
      'image': 'assets/images/scorpio_n_black.png',
      'fallbackIcon': Icons.directions_car_rounded,
    },
    {
      'title': 'Force Traveller',
      'category': 'traveller',
      'filter': 'Car',
      'subtitle': '12 seater • Group travel',
      'price': '₹400-700',
      'image': 'assets/images/rental_visual.jpg',
      'fallbackIcon': Icons.airport_shuttle_rounded,
    },
  ];

  @override
  Widget build(BuildContext context) {
    final filteredVehicles = _selectedFilter == 'All'
        ? _allVehicles
        : _allVehicles.where((v) => v['filter'] == _selectedFilter).toList();

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
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: isSelected ? const Color(0xFF16A34A) : Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: isSelected ? const Color(0xFF16A34A) : const Color(0xFFE5E7EB),
                        ),
                      ),
                      child: Center(
                        child: Text(
                          filter,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: isSelected ? Colors.white : const Color(0xFF374151),
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
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final vehicle = filteredVehicles[index];
                return GestureDetector(
                  onTap: () {
                    ref.read(rideProvider.notifier).selectSector('passenger');
                    ref.read(rideProvider.notifier).selectTier(vehicle['category']);
                    context.push('/ride-booking');
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE5E7EB)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.03),
                          blurRadius: 6,
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
                              Text(
                                vehicle['title'],
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF111827),
                                ),
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

                        // Price and Chevron with fixed width to prevent clipping
                        SizedBox(
                          width: 80,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                vehicle['price'],
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF111827),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.visible,
                              ),
                              const SizedBox(height: 4),
                              const Icon(
                                Icons.chevron_right_rounded,
                                size: 18,
                                color: Color(0xFF9CA3AF),
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
        ],
      ),
    );
  }
}
