import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/ride_provider.dart';

class SpecialtyEmergencyScreen extends ConsumerStatefulWidget {
  const SpecialtyEmergencyScreen({super.key});

  @override
  ConsumerState<SpecialtyEmergencyScreen> createState() => _SpecialtyEmergencyScreenState();
}

class _SpecialtyEmergencyScreenState extends ConsumerState<SpecialtyEmergencyScreen> {
  String _selectedFilter = 'All';

  final List<String> _filters = ['All', 'Emergency', 'Construction', 'Support'];

  final List<Map<String, dynamic>> _vehicles = [
    {
      'title': 'Ambulance',
      'category': 'ambulance',
      'filter': 'Emergency',
      'subtitle': 'Patient + Medical Triage • Trip-Based',
      'image': 'assets/images/ambulance_visual.jpg',
      'fallbackIcon': Icons.medical_services_rounded,
    },
    {
      'title': 'Towing Van',
      'category': 'towing',
      'filter': 'Emergency',
      'subtitle': 'Breakdown Assist • Trip-Based',
      'image': 'assets/images/flatbed_towing_truck.png',
      'fallbackIcon': Icons.fire_truck_rounded,
    },
    {
      'title': 'JCB / Excavator',
      'category': 'jcb',
      'filter': 'Construction',
      'subtitle': 'Specialty Excavation • Trip-Based',
      'image': 'assets/images/tata_pickup_207_heightened.png',
      'fallbackIcon': Icons.construction_rounded,
    },
    {
      'title': 'Crane',
      'category': 'crane',
      'filter': 'Construction',
      'subtitle': 'Heavy Lifting • Trip-Based',
      'image': 'assets/images/tata_407_beige.png',
      'fallbackIcon': Icons.precision_manufacturing_rounded,
    },
    {
      'title': 'Roadside Assist',
      'category': 'roadside_assist',
      'filter': 'Support',
      'subtitle': 'Tire / Battery Support • Trip-Based',
      'image': 'assets/images/towing_van_green.png',
      'fallbackIcon': Icons.home_repair_service_rounded,
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
          'Specialty & Emergency',
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
                    ref.read(rideProvider.notifier).selectSector('service');
                    ref.read(rideProvider.notifier).selectTier(item['category']);
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
                        // Image Thumbnail
                        Container(
                          width: 60,
                          height: 50,
                          decoration: BoxDecoration(
                            color: const Color(0xFFF3F4F6),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Image.asset(
                              item['image'],
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) => Icon(
                                item['fallbackIcon'] as IconData,
                                size: 30,
                                color: const Color(0xFFDC2626),
                              ),
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
                              ),
                              const SizedBox(height: 4),
                              Text(
                                item['subtitle'],
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B7280),
                                ),
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
