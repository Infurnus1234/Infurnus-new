import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/ride_provider.dart';

class RentalsScreen extends ConsumerStatefulWidget {
  const RentalsScreen({super.key});

  @override
  ConsumerState<RentalsScreen> createState() => _RentalsScreenState();
}

class _RentalsScreenState extends ConsumerState<RentalsScreen> {
  String _selectedFilter = 'All';

  final List<String> _filters = ['All', 'SUV', 'Off-road', 'Luxury', 'Vans'];

  final List<Map<String, dynamic>> _vehicles = [
    {
      'title': 'Innova Crysta',
      'category': 'innova',
      'filter': 'Luxury',
      'subtitle': 'Executive • Chauffeur + Fuel',
      'image': 'assets/images/innova_crysta_clean.jpg',
      'fallbackIcon': Icons.directions_car_rounded,
    },
    {
      'title': 'Toyota Fortuner',
      'category': 'fortuner',
      'filter': 'SUV',
      'subtitle': 'Commanding SUV • Chauffeur + Fuel',
      'image': 'assets/images/fortuner_visual.jpg',
      'fallbackIcon': Icons.directions_car_filled_rounded,
    },
    {
      'title': 'Force Traveller',
      'category': 'traveller',
      'filter': 'Vans',
      'subtitle': '12 seater luxury van • Chauffeur + Fuel',
      'image': 'assets/images/force_traveller_clean.jpg',
      'fallbackIcon': Icons.airport_shuttle_rounded,
    },
    {
      'title': 'Off-road SUV (Thar)',
      'category': 'thar',
      'filter': 'Off-road',
      'subtitle': 'Rugged 4x4 • Chauffeur + Fuel',
      'image': 'assets/images/thar_visual.webp',
      'fallbackIcon': Icons.directions_car_filled_rounded,
    },
    {
      'title': 'Scorpio N',
      'category': 'scorpio_n',
      'filter': 'SUV',
      'subtitle': 'Rugged SUV • Chauffeur + Fuel',
      'image': 'assets/images/scorpio_n_white.png',
      'fallbackIcon': Icons.directions_car_filled_rounded,
    },
    {
      'title': 'Helicopter',
      'category': 'helicopter',
      'filter': 'Luxury',
      'subtitle': 'On-demand • Chauffeur + Pilot',
      'image': null,
      'fallbackIcon': Icons.flight_takeoff_rounded,
    },
    {
      'title': 'Charter Flight',
      'category': 'charter_flight',
      'filter': 'Luxury',
      'subtitle': 'Private Aircraft • Crew Included',
      'image': null,
      'fallbackIcon': Icons.flight_rounded,
    },
    {
      'title': 'Yacht',
      'category': 'yacht',
      'filter': 'Luxury',
      'subtitle': 'Luxury Cruise • Captain Included',
      'image': null,
      'fallbackIcon': Icons.directions_boat_rounded,
    },
  ];

  @override
  Widget build(BuildContext context) {
    final filtered = _selectedFilter == 'All'
        ? _vehicles
        : _vehicles.where((v) => v['filter'] == _selectedFilter).toList();

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
          'The Concierge Fleet',
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

          // Vertical Vehicle List
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              itemCount: filtered.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final item = filtered[index];
                return GestureDetector(
                  onTap: () {
                    ref.read(rideProvider.notifier).selectSector('premium');
                    ref
                        .read(rideProvider.notifier)
                        .selectTier(item['category']);
                    context.push('/ride-booking');
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 14,
                    ),
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
                        // Image Thumbnail
                        Container(
                          width: 80,
                          height: 60,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: const Color(0xFFE5E7EB),
                              width: 0.5,
                            ),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: item['image'] != null
                                ? Image.asset(
                                    item['image'] as String,
                                    fit: BoxFit.contain,
                                    errorBuilder: (_, __, ___) => Icon(
                                      item['fallbackIcon'] as IconData,
                                      size: 30,
                                      color: const Color(0xFFCA8A04),
                                    ),
                                  )
                                : Icon(
                                    item['fallbackIcon'] as IconData,
                                    size: 30,
                                    color: const Color(0xFFCA8A04),
                                  ),
                          ),
                        ),
                        const SizedBox(width: 14),

                        // Title & Subtitle
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item['title'],
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF111827),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                item['subtitle'],
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

                        // Trailing Chevron
                        const Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                          color: Color(0xFF9CA3AF),
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
