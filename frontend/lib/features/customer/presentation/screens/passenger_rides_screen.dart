import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/vehicle_visual_image.dart';
import '../providers/ride_provider.dart';

class PassengerRidesScreen extends ConsumerStatefulWidget {
  const PassengerRidesScreen({super.key});

  @override
  ConsumerState<PassengerRidesScreen> createState() => _PassengerRidesScreenState();
}

class _PassengerRidesScreenState extends ConsumerState<PassengerRidesScreen> {
  String _selectedFilter = 'All';

  final List<String> _filters = ['All', 'Bike', 'Auto', 'E-Rickshaw', 'Car'];

  final List<Map<String, String>> _passengerRides = [
    {
      'title': 'Bike',
      'category': 'bike',
      'capacity': '1 rider',
      'description': 'Fast & affordable',
      'price': '₹35-60',
      'filterCategory': 'Bike',
    },
    {
      'title': 'Auto',
      'category': 'auto',
      'capacity': '3 seater',
      'description': 'Everyday travel',
      'price': '₹60-100',
      'filterCategory': 'Auto',
    },
    {
      'title': 'E-Rickshaw',
      'category': 'e_rickshaw',
      'capacity': '4 seater',
      'description': 'Eco-friendly',
      'price': '₹50-90',
      'filterCategory': 'E-Rickshaw',
    },
    {
      'title': 'Hatchback',
      'category': 'hatchback',
      'capacity': '4 seater',
      'description': 'Compact & comfortable',
      'price': '₹120-180',
      'filterCategory': 'Car',
    },
    {
      'title': 'Sedan',
      'category': 'sedan',
      'capacity': '4 seater',
      'description': 'Premium comfort',
      'price': '₹150-220',
      'filterCategory': 'Car',
    },
    {
      'title': 'SUV / Scorpio N',
      'category': 'suv',
      'capacity': '6-7 seater',
      'description': 'Spacious & powerful',
      'price': '₹200-350',
      'filterCategory': 'Car',
    },
    {
      'title': 'Force Traveller',
      'category': 'traveller',
      'capacity': '12 seater',
      'description': 'Group travel',
      'price': '₹400-700',
      'filterCategory': 'Car',
    },
  ];

  @override
  Widget build(BuildContext context) {
    final filteredRides = _passengerRides.where((item) {
      if (_selectedFilter == 'All') return true;
      return item['filterCategory'] == _selectedFilter;
    }).toList();

    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF111827)),
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
        centerTitle: false,
      ),
      body: Column(
        children: [
          // Filter Horizontal Chips
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: SizedBox(
              height: 38,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _filters.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final filter = _filters[index];
                  final isSelected = filter == _selectedFilter;
                  return ChoiceChip(
                    label: Text(filter),
                    selected: isSelected,
                    selectedColor: AppColors.primaryGreen,
                    backgroundColor: const Color(0xFFF3F4F6),
                    labelStyle: TextStyle(
                      color: isSelected ? Colors.white : const Color(0xFF4B5563),
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: BorderSide(
                        color: isSelected ? AppColors.primaryGreen : const Color(0xFFE5E7EB),
                      ),
                    ),
                    onSelected: (selected) {
                      if (selected) {
                        setState(() => _selectedFilter = filter);
                      }
                    },
                  );
                },
              ),
            ),
          ),
          const Divider(height: 1, color: Color(0xFFE5E7EB)),

          // Rides List
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: filteredRides.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final item = filteredRides[index];
                return GestureDetector(
                  onTap: () {
                    ref.read(rideProvider.notifier).selectSector('passenger');
                    ref.read(rideProvider.notifier).selectTier(item['category']!);
                    context.push('/ride-booking');
                  },
                  child: Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE5E7EB)),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x08000000),
                          blurRadius: 8,
                          offset: Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        VehicleVisualImage(
                          vehicleName: item['title'],
                          category: item['category'],
                          width: 68,
                          height: 52,
                          borderRadius: 12,
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item['title']!,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF111827),
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                item['capacity']!,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B7280),
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                item['description']!,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF9CA3AF),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              item['price']!,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF111827),
                              ),
                            ),
                            const SizedBox(height: 8),
                            const Icon(
                              Icons.chevron_right_rounded,
                              color: Color(0xFF9CA3AF),
                              size: 20,
                            ),
                          ],
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
