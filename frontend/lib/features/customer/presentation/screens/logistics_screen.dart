import '../providers/booking_catalog_provider.dart';
import '../widgets/vehicle_presentation_catalog.dart';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/ride_provider.dart';
import '../../../../shared/widgets/infurnus_button.dart';

class LogisticsScreen extends ConsumerStatefulWidget {
  const LogisticsScreen({super.key});

  @override
  ConsumerState<LogisticsScreen> createState() => _LogisticsScreenState();
}

class _LogisticsScreenState extends ConsumerState<LogisticsScreen> {
  String _selectedFilter = 'All';

  final List<String> _filters = ['All', '3-Wheeler', 'Mini Truck', 'Truck'];

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final fareEstimate = rideState.fareEstimate;
    final isUnavailable = fareEstimate?.isUnavailable ?? false;
    final hasBookingAmount = fareEstimate?.bookingAmount != null;

    final vehicles = customerVehiclePresentation(
      'logistics',
      ref.watch(bookingCatalogProvider('logistics')).value ?? [],
    );
    final filtered = _selectedFilter == 'All'
        ? vehicles
        : vehicles.where((v) => v['filter'] == _selectedFilter).toList();

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
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

          // Fare unavailability message
          if (isUnavailable && fareEstimate?.message != null)
            Container(
              width: double.infinity,
              color: const Color(0xFFFEF3C7),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Text(
                fareEstimate!.message!,
                style: const TextStyle(color: Color(0xFF92400E), fontSize: 13),
              ),
            ),

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
                        .selectTier(item['category']!);
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
                          width: 80,
                          height: 60,
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: const Color(0xFFE5E7EB),
                              width: 0.5,
                            ),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.asset(
                              item['image']!,
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) => Icon(
                                item['filter'] == '3-Wheeler'
                                    ? Icons.electric_rickshaw_rounded
                                    : Icons.local_shipping_rounded,
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
                            children: [
                              Text(
                                item['name']!,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF111827),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                item['subtitle']!,
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

          // Booking confirmation button — enabled only when a booking quote exists
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: InfurnusButton(
              text: 'Confirm Booking',
              onPressed: hasBookingAmount
                  ? () => context.push('/ride-booking')
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}
