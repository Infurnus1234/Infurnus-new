import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../providers/driver_dashboard_provider.dart';
import '../providers/driver_providers.dart';
import '../../data/models/vehicle_model.dart';

class DriverVehiclesScreen extends ConsumerStatefulWidget {
  const DriverVehiclesScreen({super.key});

  @override
  ConsumerState<DriverVehiclesScreen> createState() => _DriverVehiclesScreenState();
}

class _DriverVehiclesScreenState extends ConsumerState<DriverVehiclesScreen> {
  final _driverProfileIdController = TextEditingController();
  final _makeController = TextEditingController();
  final _modelController = TextEditingController();
  final _colorController = TextEditingController();
  final _plateNumberController = TextEditingController();

  List<VehicleModel> _vehicles = [];
  bool _isLoading = false;
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadVehicles();
    });
  }

  @override
  void dispose() {
    _driverProfileIdController.dispose();
    _makeController.dispose();
    _modelController.dispose();
    _colorController.dispose();
    _plateNumberController.dispose();
    super.dispose();
  }

  Future<void> _loadVehicles() async {
    final partner = ref.read(driverDashboardProvider).partner;
    if (partner == null) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final list = await ref.read(listVehiclesUseCaseProvider).execute(partner.id);
      if (mounted) {
        setState(() {
          _isLoading = false;
          _vehicles = list;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  Future<void> _addVehicle() async {
    if (_driverProfileIdController.text.trim().isEmpty ||
        _makeController.text.trim().isEmpty ||
        _modelController.text.trim().isEmpty ||
        _plateNumberController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill in required fields')),
      );
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final vehicleData = {
        'driverProfileId': _driverProfileIdController.text.trim(),
        'make': _makeController.text.trim(),
        'model': _modelController.text.trim(),
        if (_colorController.text.trim().isNotEmpty) 'color': _colorController.text.trim(),
        'plateNumber': _plateNumberController.text.trim(),
      };

      await ref.read(createVehicleUseCaseProvider).execute(vehicleData);
      await _loadVehicles();
      await ref.read(driverDashboardProvider.notifier).loadDashboard();

      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _makeController.clear();
          _modelController.clear();
          _colorController.clear();
          _plateNumberController.clear();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Vehicle registered successfully!')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  Future<void> _deactivateVehicle(String vehicleId) async {
    setState(() => _isLoading = true);
    try {
      await ref.read(deactivateVehicleUseCaseProvider).execute(vehicleId);
      await _loadVehicles();
      await ref.read(driverDashboardProvider.notifier).loadDashboard();
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final partner = ref.watch(driverDashboardProvider).partner;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Registered Vehicles'),
      ),
      body: _isLoading
          ? const InfurnusLoader(message: 'Loading Vehicles...')
          : partner == null
              ? const Center(child: Text('Partner Profile required.'))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_errorMessage != null) _buildErrorBanner(_errorMessage!),

                      // Vehicle Register Form
                      InfurnusCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Register New Vehicle', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 12),
                            InfurnusTextField(
                              label: 'Driver Profile UUID',
                              hintText: 'Enter driverProfileId',
                              controller: _driverProfileIdController,
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                Expanded(
                                  child: InfurnusTextField(
                                    label: 'Make',
                                    hintText: 'Toyota',
                                    controller: _makeController,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: InfurnusTextField(
                                    label: 'Model',
                                    hintText: 'Camry',
                                    controller: _modelController,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                Expanded(
                                  child: InfurnusTextField(
                                    label: 'Color (Optional)',
                                    hintText: 'White',
                                    controller: _colorController,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: InfurnusTextField(
                                    label: 'Plate Number',
                                    hintText: 'KA-01-AB-1234',
                                    controller: _plateNumberController,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            InfurnusButton(
                              text: 'Register Vehicle',
                              isLoading: _isSubmitting,
                              onPressed: _addVehicle,
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 24),
                      const Text('Vehicle Fleet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 12),

                      if (_vehicles.isEmpty)
                        const Center(child: Text('No vehicles registered.'))
                      else
                        ListView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: _vehicles.length,
                          itemBuilder: (context, index) {
                            final vehicle = _vehicles[index];
                            return Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              child: InfurnusCard(
                                child: Row(
                                  children: [
                                    const Icon(Icons.directions_car, color: AppColors.primaryGreen, size: 36),
                                    const SizedBox(width: 16),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text('${vehicle.make} ${vehicle.model}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                          Text('Plate: ${vehicle.plateNumber}', style: TextStyle(color: Colors.grey[600], fontSize: 13)),
                                        ],
                                      ),
                                    ),
                                    if (vehicle.isActive)
                                      IconButton(
                                        icon: const Icon(Icons.power_settings_new, color: Colors.red),
                                        onPressed: () => _deactivateVehicle(vehicle.id),
                                      ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildErrorBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.red[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red[200]!),
      ),
      child: Text(message, style: const TextStyle(color: Colors.red, fontSize: 13)),
    );
  }
}
