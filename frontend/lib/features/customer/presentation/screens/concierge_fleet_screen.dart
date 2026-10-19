import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/vehicle_visual_image.dart';
import '../providers/ride_provider.dart';

class ConciergeFleetScreen extends ConsumerStatefulWidget {
  const ConciergeFleetScreen({super.key});

  @override
  ConsumerState<ConciergeFleetScreen> createState() => _ConciergeFleetScreenState();
}

class _ConciergeFleetScreenState extends ConsumerState<ConciergeFleetScreen> {
  String _selectedFilter = 'All';

  final List<String> _filters = ['All', 'SUV', 'Off-road', 'Luxury', 'Vans'];

  final List<Map<String, String>> _conciergeVehicles = [
    {
      'title': 'Scorpio N',
      'category': 'scorpio',
      'subtitle': 'Rugged SUV',
      'service': 'Chauffeur + Fuel',
      'filterCategory': 'SUV',
    },
    {
      'title': 'Mahindra Thar',
      'category': 'thar',
      'subtitle': 'Off-road',
      'service': 'Chauffeur + Fuel',
      'filterCategory': 'Off-road',
    },
    {
      'title': 'Innova Crysta',
      'category': 'innova',
      'subtitle': 'Executive',
      'service': 'Chauffeur + Fuel',
      'filterCategory': 'Luxury',
    },
    {
      'title': 'Force Traveller',
      'category': 'traveller',
      'subtitle': '12 seater',
      'service': 'Chauffeur + Fuel',
      'filterCategory': 'Vans',
    },
    {
      'title': 'Mercedes V-Class',
      'category': 'mercedes',
      'subtitle': 'Luxury Van',
      'service': 'Chauffeur + Fuel',
      'filterCategory': 'Luxury',
    },
    {
      'title': 'Helicopter',
      'category': 'helicopter',
      'subtitle': 'On-demand',
      'service': 'Chauffeur + Pilot',
      'filterCategory': 'Luxury',
    },
  ];

  @override
  Widget build(BuildContext context) {
    final filteredVehicles = _conciergeVehicles.where((item) {
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
          'The Concierge Fleet',
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
          // Filter Chips
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

          // List
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: filteredVehicles.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final item = filteredVehicles[index];
                return GestureDetector(
                  onTap: () {
                    ref.read(rideProvider.notifier).selectSector('premium');
                    ref.read(rideProvider.notifier).selectTier(item['category']!);
                    context.push('/rentals');
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
                                item['subtitle']!,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B7280),
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                item['service']!,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF9CA3AF),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right_rounded,
                          color: Color(0xFF9CA3AF),
                          size: 24,
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
