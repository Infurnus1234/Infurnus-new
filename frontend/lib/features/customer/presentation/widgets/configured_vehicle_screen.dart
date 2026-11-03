import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../shared/widgets/vehicle_visual_image.dart';
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
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            tooltip: 'Refresh vehicles',
            onPressed: () => ref.invalidate(bookingCatalogProvider(sector)),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'Choose your vehicle. Availability is checked near your selected pickup. You can book from anywhere.',
            ),
          ),
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
              data: (items) => items.isEmpty
                  ? const Center(
                      child: Text(
                        'No vehicles are configured for this service yet.',
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final vehicle = items[index];
                        return Card(
                          child: ListTile(
                            leading: VehicleVisualImage(
                              vehicleName: vehicle.displayName,
                              category: vehicle.category,
                              imageUrl: vehicle.imageUrl,
                            ),
                            title: Text(vehicle.displayName),
                            subtitle: Text(
                              sector == 'service' && vehicle.pricing != null
                                  ? '₹${vehicle.pricing!.toStringAsFixed(2)} fixed · ${vehicle.range ?? ''}'
                                  : 'Fare confirmed for your selected route',
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () {
                              ref
                                  .read(rideProvider.notifier)
                                  .selectSector(sector);
                              ref
                                  .read(rideProvider.notifier)
                                  .selectTier(vehicle.category);
                              context.push('/ride-booking');
                            },
                          ),
                        );
                      },
                    ),
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
