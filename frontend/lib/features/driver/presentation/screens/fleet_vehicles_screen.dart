import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../../data/models/vehicle_model.dart';
import '../providers/driver_providers.dart';

final fleetVehiclesFutureProvider =
    FutureProvider.autoDispose<List<VehicleModel>>((ref) async {
  final ds = ref.watch(driverRemoteDataSourceProvider);
  return ds.listFleetVehicles();
});

class FleetVehiclesScreen extends ConsumerStatefulWidget {
  const FleetVehiclesScreen({super.key});

  @override
  ConsumerState<FleetVehiclesScreen> createState() => _FleetVehiclesScreenState();
}

class _FleetVehiclesScreenState extends ConsumerState<FleetVehiclesScreen> {
  // New Vehicle Controllers
  final _makeController = TextEditingController();
  final _modelController = TextEditingController();
  final _plateController = TextEditingController();
  final _colorController = TextEditingController();
  final _fuelTypeController = TextEditingController();
  final _seatingController = TextEditingController(text: '4');
  final _loadCapacityController = TextEditingController(text: '0');
  String _selectedSector = 'passenger';
  String _selectedCategory = 'sedan';
  bool _isCreating = false;

  @override
  void dispose() {
    _makeController.dispose();
    _modelController.dispose();
    _plateController.dispose();
    _colorController.dispose();
    _fuelTypeController.dispose();
    _seatingController.dispose();
    _loadCapacityController.dispose();
    super.dispose();
  }

  void _showGenerateCodeDialog(VehicleModel vehicle) async {
    try {
      final ds = ref.read(driverRemoteDataSourceProvider);
      final result = await ds.generateFleetAssignmentCode(vehicle.id);
      final code = result['code'] as String? ?? '';

      if (!mounted) return;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF16221A),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('Driver Assignment Code', style: TextStyle(color: Colors.white, fontSize: 18)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Share this code with your driver to assign ${vehicle.make} ${vehicle.model} (${vehicle.plateNumber}):',
                style: TextStyle(color: Colors.grey[300], fontSize: 13),
              ),
              const SizedBox(height: 20),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
                decoration: BoxDecoration(
                  color: AppColors.primaryGreen.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.primaryGreen),
                ),
                child: Center(
                  child: SelectableText(
                    code,
                    style: const TextStyle(
                      color: AppColors.primaryGreen,
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.timer_outlined, size: 14, color: Colors.amber),
                  SizedBox(width: 4),
                  Text(
                    'Valid for 48 hours • Single-use',
                    style: TextStyle(color: Colors.amber, fontSize: 12),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: code));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Assignment code copied to clipboard')),
                );
                Navigator.pop(ctx);
                ref.invalidate(fleetVehiclesFutureProvider);
              },
              child: const Text('Copy Code', style: TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.bold)),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                ref.invalidate(fleetVehiclesFutureProvider);
              },
              child: const Text('Done', style: TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to generate code: $e')),
        );
      }
    }
  }

  void _unassignDriver(VehicleModel vehicle) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E2621),
        title: const Text('Unassign Driver?', style: TextStyle(color: Colors.white)),
        content: Text(
          'Are you sure you want to unassign driver from ${vehicle.make} ${vehicle.model}?',
          style: TextStyle(color: Colors.grey[300]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Unassign', style: TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        final ds = ref.read(driverRemoteDataSourceProvider);
        await ds.unassignFleetDriver(vehicle.id);
        ref.invalidate(fleetVehiclesFutureProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Driver unassigned successfully')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
        }
      }
    }
  }

  void _showAddVehicleSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF141916),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Add Fleet Vehicle',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white70),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                InfurnusTextField(label: 'Make', controller: _makeController, hintText: 'e.g. Maruti / Toyota'),
                const SizedBox(height: 12),
                InfurnusTextField(label: 'Model', controller: _modelController, hintText: 'e.g. Dzire / Innova'),
                const SizedBox(height: 12),
                InfurnusTextField(label: 'Plate Number', controller: _plateController, hintText: 'e.g. KA-01-AB-1234'),
                const SizedBox(height: 12),
                InfurnusTextField(label: 'Color (Optional)', controller: _colorController, hintText: 'e.g. White'),
                const SizedBox(height: 12),
                InfurnusTextField(label: 'Fuel Type (Optional)', controller: _fuelTypeController, hintText: 'e.g. CNG / Petrol / EV'),
                const SizedBox(height: 16),
                const Text('Sector', style: TextStyle(color: Colors.white70, fontSize: 13)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: _selectedSector,
                  dropdownColor: const Color(0xFF1E2621),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF1E2621),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'passenger', child: Text('Passenger')),
                    DropdownMenuItem(value: 'logistics', child: Text('Logistics')),
                    DropdownMenuItem(value: 'service', child: Text('Service')),
                    DropdownMenuItem(value: 'premium', child: Text('Premium')),
                  ],
                  onChanged: (val) {
                    if (val != null) setSheetState(() => _selectedSector = val);
                  },
                ),
                const SizedBox(height: 22),
                InfurnusButton(
                  text: _isCreating ? 'Adding Vehicle...' : 'Register Vehicle',
                  isLoading: _isCreating,
                  onPressed: _isCreating
                      ? null
                      : () async {
                          if (_makeController.text.trim().isEmpty ||
                              _modelController.text.trim().isEmpty ||
                              _plateController.text.trim().isEmpty) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Please fill Make, Model and Plate number')),
                            );
                            return;
                          }

                          setSheetState(() => _isCreating = true);
                          try {
                            final ds = ref.read(driverRemoteDataSourceProvider);
                            await ds.createFleetVehicle({
                              'make': _makeController.text.trim(),
                              'model': _modelController.text.trim(),
                              'plateNumber': _plateController.text.trim().toUpperCase(),
                              if (_colorController.text.trim().isNotEmpty)
                                'color': _colorController.text.trim(),
                              if (_fuelTypeController.text.trim().isNotEmpty)
                                'fuelType': _fuelTypeController.text.trim(),
                              'sector': _selectedSector,
                              'category': _selectedCategory,
                              'seatingCapacity': int.tryParse(_seatingController.text) ?? 4,
                              'loadCapacityKg': double.tryParse(_loadCapacityController.text) ?? 0.0,
                              'isCommercial': true,
                            });

                            _makeController.clear();
                            _modelController.clear();
                            _plateController.clear();
                            _colorController.clear();
                            _fuelTypeController.clear();
                            if (ctx.mounted) Navigator.pop(ctx);
                            ref.invalidate(fleetVehiclesFutureProvider);

                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Fleet vehicle added successfully'),
                                  backgroundColor: AppColors.primaryGreen,
                                ),
                              );
                            }
                          } catch (e) {
                            setSheetState(() => _isCreating = false);
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
                            }
                          }
                        },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final vehiclesAsync = ref.watch(fleetVehiclesFutureProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Fleet Vehicles'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(fleetVehiclesFutureProvider),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showAddVehicleSheet,
        backgroundColor: AppColors.primaryGreen,
        icon: const Icon(Icons.add, color: Colors.black),
        label: const Text('Add Vehicle', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
      ),
      body: vehiclesAsync.when(
        loading: () => const InfurnusLoader(message: 'Loading fleet vehicles...'),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (vehicles) {
          if (vehicles.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.directions_car_outlined, size: 64, color: Colors.grey[600]),
                  const SizedBox(height: 16),
                  const Text('No Fleet Vehicles', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('Register your fleet vehicles to assign drivers.', style: TextStyle(color: Colors.grey[400])),
                ],
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(20),
            itemCount: vehicles.length,
            separatorBuilder: (_, __) => const SizedBox(height: 14),
            itemBuilder: (context, idx) {
              final vehicle = vehicles[idx];
              final hasDriver = vehicle.driverProfileId != null;

              return InfurnusCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '${vehicle.make} ${vehicle.model}',
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: vehicle.isActive
                                ? AppColors.primaryGreen.withOpacity(0.15)
                                : Colors.red.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            vehicle.isActive ? 'ACTIVE' : 'INACTIVE',
                            style: TextStyle(
                              color: vehicle.isActive ? AppColors.primaryGreen : Colors.red,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      vehicle.plateNumber,
                      style: const TextStyle(
                        letterSpacing: 1.2,
                        fontWeight: FontWeight.w600,
                        color: Colors.white70,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.white10,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            vehicle.sector.toUpperCase(),
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white60),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          hasDriver ? 'Driver Assigned' : 'Unassigned',
                          style: TextStyle(
                            color: hasDriver ? AppColors.primaryGreen : Colors.amber,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        if (vehicle.activeAssignmentCode != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            'Code: ${vehicle.activeAssignmentCode}',
                            style: const TextStyle(color: Colors.cyanAccent, fontSize: 11),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 14),
                    const Divider(color: Colors.white10),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (hasDriver)
                          TextButton.icon(
                            onPressed: () => _unassignDriver(vehicle),
                            icon: const Icon(Icons.person_remove, size: 16, color: Colors.redAccent),
                            label: const Text('Unassign', style: TextStyle(color: Colors.redAccent, fontSize: 12)),
                          ),
                        const SizedBox(width: 8),
                        ElevatedButton.icon(
                          onPressed: () => _showGenerateCodeDialog(vehicle),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primaryGreen.withOpacity(0.15),
                            foregroundColor: AppColors.primaryGreen,
                            elevation: 0,
                          ),
                          icon: const Icon(Icons.vpn_key, size: 16),
                          label: Text(
                            vehicle.activeAssignmentCode != null ? 'View Code' : 'Assign Code',
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                          ),
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
