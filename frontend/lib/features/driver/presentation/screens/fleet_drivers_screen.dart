import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../data/models/fleet_driver_model.dart';
import '../providers/driver_providers.dart';

final fleetDriversFutureProvider =
    FutureProvider.autoDispose<List<FleetDriverModel>>((ref) async {
  final ds = ref.watch(driverRemoteDataSourceProvider);
  return ds.listFleetDrivers();
});

class FleetDriversScreen extends ConsumerWidget {
  const FleetDriversScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final driversAsync = ref.watch(fleetDriversFutureProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Fleet Drivers'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(fleetDriversFutureProvider),
          ),
        ],
      ),
      body: driversAsync.when(
        loading: () => const InfurnusLoader(message: 'Loading fleet drivers...'),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (drivers) {
          if (drivers.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.people_outline, size: 64, color: Colors.grey[600]),
                  const SizedBox(height: 16),
                  const Text('No Drivers Assigned', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(
                    'Generate an assignment code from "Fleet Vehicles" and share it with your driver.',
                    style: TextStyle(color: Colors.grey[400], fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(20),
            itemCount: drivers.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, idx) {
              final driver = drivers[idx];
              final isOnline = driver.availabilityStatus == 'available';

              return InfurnusCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: AppColors.primaryGreen.withOpacity(0.15),
                              radius: 20,
                              child: Text(
                                driver.name.isNotEmpty ? driver.name[0].toUpperCase() : 'D',
                                style: const TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.bold),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  driver.name,
                                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  driver.phone,
                                  style: TextStyle(color: Colors.grey[400], fontSize: 12),
                                ),
                              ],
                            ),
                          ],
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: isOnline
                                ? AppColors.primaryGreen.withOpacity(0.15)
                                : Colors.grey.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            isOnline ? 'ONLINE' : 'OFFLINE',
                            style: TextStyle(
                              color: isOnline ? AppColors.primaryGreen : Colors.grey,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    const Divider(color: Colors.white10),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Assigned Vehicle', style: TextStyle(color: Colors.white54, fontSize: 11)),
                            const SizedBox(height: 2),
                            Text(
                              driver.assignedVehicle != null
                                  ? '${driver.assignedVehicle!['make']} ${driver.assignedVehicle!['model']} (${driver.assignedVehicle!['plateNumber']})'
                                  : 'None',
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                            ),
                          ],
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            const Text('Completed Trips', style: TextStyle(color: Colors.white54, fontSize: 11)),
                            const SizedBox(height: 2),
                            Text(
                              '${driver.completedTrips}',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 15,
                                color: AppColors.primaryGreen,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
