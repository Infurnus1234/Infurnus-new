import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/ride_provider.dart';

class LogisticsScreen extends ConsumerStatefulWidget {
  const LogisticsScreen({super.key});

  @override
  ConsumerState<LogisticsScreen> createState() => _LogisticsScreenState();
}

class _LogisticsScreenState extends ConsumerState<LogisticsScreen> {
  String _selectedFilter = 'All';

  final List<String> _filters = ['All', '3-Wheeler', 'Mini Truck', 'Truck'];

  final List<Map<String, dynamic>> _vehicles = [
    {
      'title': 'Piaggio Ape',
      'category': 'piaggio_ape',
      'filter': '3-Wheeler',
      'subtitle': 'Up to 500 kg • City delivery',
      'image': 'assets/images/piaggio_ape_yellow.png',
      'fallbackIcon': Icons.electric_rickshaw_rounded,
    },
    {
      'title': 'Tata Magic',
      'category': 'tata_magic',
      'filter': 'Mini Truck',
      'subtitle': 'Up to 750 kg • Goods transport',
      'image': 'assets/images/tata_magic_cream.png',
      'fallbackIcon': Icons.local_shipping_rounded,
    },
    {
      'title': '207 Cargo',
      'category': 'cargo_207',
      'filter': 'Mini Truck',
      'subtitle': 'Up to 1200 kg • Medium cargo',
      'image': 'assets/images/cargo_207_heavy.png',
      'fallbackIcon': Icons.local_shipping_rounded,
    },
    {
      'title': '407 Cargo',
      'category': 'cargo_407',
      'filter': 'Truck',
      'subtitle': 'Up to 2500 kg • Heavy cargo',
      'image': 'assets/images/tata_407_beige.png',
      'fallbackIcon': Icons.fire_truck_rounded,
    },
    {
      'title': 'Pickup Truck',
      'category': 'pickup_truck',
      'filter': 'Mini Truck',
      'subtitle': 'Up to 1500 kg • Flexible cargo',
      'image': 'assets/images/cargo_207_normal.png',
      'fallbackIcon': Icons.local_shipping_rounded,
    },
    {
      'title': 'Mini Truck',
      'category': 'mini_truck',
      'filter': 'Truck',
      'subtitle': 'Up to 2000 kg • Bulk delivery',
      'image': 'assets/images/cargo_207_heavy.png',
      'fallbackIcon': Icons.local_shipping_rounded,
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
          'Logistics',
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
                    ref.read(rideProvider.notifier).selectSector('logistics');
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
                        // Image
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
