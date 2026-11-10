import 'vehicle_presentation_catalog.dart';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../shared/widgets/infurnus_button.dart';
import '../providers/booking_catalog_provider.dart';
import '../providers/ride_provider.dart';

class ConfiguredVehicleScreen extends ConsumerWidget {
  final String title;
  final String sector;
  const ConfiguredVehicleScreen({
    super.key,
    required this.title,
    required this.sector,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(bookingCatalogProvider(sector));
    final state = ref.watch(rideProvider);
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
        title: Text(
          title,
          style: const TextStyle(
            color: Color(0xFF111827),
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: Column(
        children: [
          if (sector == 'logistics' &&
              state.selectedSector == sector &&
              state.fareEstimate?.isUnavailable == true)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                state.fareEstimate!.message ?? 'A booking quote is required.',
              ),
            ),
          Expanded(
            child: catalog.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, _) => Center(
                child: TextButton(
                  onPressed: () =>
                      ref.invalidate(bookingCatalogProvider(sector)),
                  child: const Text('Unable to load vehicles. Tap to retry.'),
                ),
              ),
              data: (fleet) {
                final items = customerVehiclePresentation(sector, fleet);
                return items.isEmpty
                    ? const Center(
                        child: Text(
                          'No vehicles are configured for this service yet.',
                        ),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 16,
                        ),
                        itemCount: items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final vehicle = items[index];
                          return GestureDetector(
                            onTap: () {
                              ref
                                  .read(rideProvider.notifier)
                                  .selectSector(sector);
                              ref
                                  .read(rideProvider.notifier)
                                  .selectTier(vehicle['category']!);
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
                                border: Border.all(
                                  color: const Color(0xFFE5E7EB),
                                ),
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
                                        vehicle['image']!,
                                        fit: BoxFit.contain,
                                        errorBuilder: (_, __, ___) =>
                                            const Icon(
                                              Icons.directions_car_rounded,
                                              size: 28,
                                              color: Color(0xFF16A34A),
                                            ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 14),

                                  // Title & Subtitle
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          vehicle['name']!,
                                          style: const TextStyle(
                                            fontSize: 15,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFF111827),
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        const Text(
                                          'Fare confirmed for your selected route',
                                          style: TextStyle(
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
                      );
              },
            ),
          ),
          if (sector == 'logistics')
            Padding(
              padding: const EdgeInsets.all(16),
              child: InfurnusButton(
                text: 'Confirm Booking',
                onPressed:
                    state.selectedSector == sector &&
                        catalog.asData?.value.any(
                              (v) => v.category == state.selectedTier,
                            ) ==
                            true &&
                        state.fareEstimate?.bookingAmount != null
                    ? () => context.push('/ride-booking')
                    : null,
              ),
            ),
        ],
      ),
    );
  }
}
