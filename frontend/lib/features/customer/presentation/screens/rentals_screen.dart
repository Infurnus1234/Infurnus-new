import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../data/models/fleet_vehicle_model.dart';
import '../providers/ride_provider.dart';
import '../providers/ride_use_case_providers.dart';

class RentalsScreen extends ConsumerStatefulWidget {
  const RentalsScreen({super.key});

  @override
  ConsumerState<RentalsScreen> createState() => _RentalsScreenState();
}

class _RentalsScreenState extends ConsumerState<RentalsScreen> {
  final _pickupController = TextEditingController();
  String _selectedVehicle = 'fortuner';
  int _selectedHours = 4;
  DateTime _selectedDate = DateTime.now();
  TimeOfDay _selectedTime = const TimeOfDay(hour: 10, minute: 0);

  List<FleetVehicleModel> _fleetVehicles = [];
  bool _isLoadingFleet = true;
  String? _fleetError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _fetchFleet();
      _detectCurrentLocation();
    });
  }

  Future<void> _fetchFleet() async {
    setState(() {
      _isLoadingFleet = true;
      _fleetError = null;
    });
    try {
      final fleet = await ref.read(getFleetUseCaseProvider)(sector: 'premium');
      if (mounted) {
        setState(() {
          _fleetVehicles = fleet;
          _isLoadingFleet = false;
          if (fleet.isNotEmpty) {
            if (!_fleetVehicles.any((v) => v.category == _selectedVehicle)) {
              _selectedVehicle = fleet.first.category;
            }
          }
        });
        _syncToRideProvider();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoadingFleet = false;
          _fleetError = e.toString();
        });
      }
    }
  }

  Future<void> _detectCurrentLocation() async {
    try {
      final pos = await ref.read(locationServiceProvider).getCurrentPosition();
      if (pos != null && mounted) {
        ref.read(rideProvider.notifier).setPickupCoords(
              LatLng(pos.latitude, pos.longitude),
              address: 'Current Location',
            );
        _pickupController.text = 'Current Location';
        _syncToRideProvider();
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _pickupController.dispose();
    super.dispose();
  }

  FleetVehicleModel? get _currentCar {
    if (_fleetVehicles.isEmpty) return null;
    return _fleetVehicles.firstWhere(
      (c) => c.category == _selectedVehicle,
      orElse: () => _fleetVehicles.first,
    );
  }

  void _syncToRideProvider() {
    final car = _currentCar;
    ref.read(rideProvider.notifier).setRoute(
          _pickupController.text.trim(),
          'Hourly Standby / As Directed',
        );
    ref.read(rideProvider.notifier).selectSector('premium');
    if (car != null) {
      ref.read(rideProvider.notifier).selectTier(car.category);
      ref.read(rideProvider.notifier).setRentalDetails({
        'hours': _selectedHours,
        'startDate':
            '${_selectedDate.year}-${_selectedDate.month.toString().padLeft(2, '0')}-${_selectedDate.day.toString().padLeft(2, '0')}',
        'startTime':
            '${_selectedTime.hour}:${_selectedTime.minute.toString().padLeft(2, '0')}',
        'fuelRatePerKm': car.fuelRatePerKm,
        'vehicleModel': '${car.make} ${car.model}',
      });
    }
  }

  void _handleBooking() {
    if (_pickupController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter pickup location')),
      );
      return;
    }

    if (_currentCar == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No premium vehicle available to book')),
      );
      return;
    }

    _syncToRideProvider();
    ref.read(rideProvider.notifier).requestRide();
    context.push('/ride-booking');
  }

  IconData _getVehicleIcon(String category) {
    switch (category.toLowerCase()) {
      case 'fortuner':
        return Icons.directions_car_filled;
      case 'thar':
        return Icons.terrain;
      case 'luxury_suv':
        return Icons.stars;
      default:
        return Icons.directions_car;
    }
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final car = _currentCar;
    final fuelRate = car?.fuelRatePerKm ?? 0.0;
    final estimatedAdvance = rideState.fare;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Premium & Luxury Fleet'),
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Banner
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.primaryDark,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.amber.withValues(alpha: 0.2),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.stars, color: Colors.amber, size: 28),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Hourly Chauffeur Service',
                          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Dedicated luxury vehicle with standby driver. Fuel billed on actual distance.',
                          style: TextStyle(color: Colors.white70, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Select Fleet
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Choose Your Vehicle', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                if (_isLoadingFleet)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primaryGreen),
                  ),
              ],
            ),
            const SizedBox(height: 12),

            if (_isLoadingFleet)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: CircularProgressIndicator(color: AppColors.primaryGreen),
                ),
              )
            else if (_fleetError != null)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.red[50],
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.red[200]!),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: Colors.red),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Unable to load active fleet: $_fleetError',
                        style: const TextStyle(color: Colors.red, fontSize: 13),
                      ),
                    ),
                    TextButton(
                      onPressed: _fetchFleet,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              )
            else if (_fleetVehicles.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.grey[50],
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.grey[200]!),
                ),
                child: Column(
                  children: [
                    Icon(Icons.directions_car_outlined, size: 40, color: Colors.grey[400]),
                    const SizedBox(height: 8),
                    const Text(
                      'No premium vehicles currently available',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'All luxury fleet units are currently on assignment.',
                      style: TextStyle(color: Colors.grey[600], fontSize: 12),
                    ),
                  ],
                ),
              )
            else
              ..._fleetVehicles.map((item) {
                final isSelected = item.category == _selectedVehicle;
                final icon = _getVehicleIcon(item.category);

                return GestureDetector(
                  onTap: () {
                    setState(() => _selectedVehicle = item.category);
                    _syncToRideProvider();
                  },
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: isSelected ? Colors.amber[50] : Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: isSelected ? Colors.amber[800]! : Colors.grey[200]!,
                        width: isSelected ? 2 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 24,
                          backgroundColor: isSelected ? Colors.amber[100] : Colors.grey[100],
                          child: Icon(icon, color: isSelected ? Colors.amber[900] : Colors.grey[800]),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${item.make} ${item.model}',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${item.category.toUpperCase()} • Chauffeur Standby',
                                style: TextStyle(color: Colors.grey[600], fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              '₹${item.fuelRatePerKm.toStringAsFixed(0)}/km',
                              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.amber[900]),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'fuel rate',
                              style: TextStyle(fontSize: 11, color: Colors.grey[600]),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              }),
            const SizedBox(height: 20),

            // Pickup & Schedule
            const Text('Trip Schedule & Pickup', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            InfurnusCard(
              child: Column(
                children: [
                  Row(
                    children: [
                      const Icon(Icons.location_on, color: Colors.red, size: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _pickupController,
                          decoration: const InputDecoration(
                            hintText: 'Pickup Location',
                            border: InputBorder.none,
                            isDense: true,
                          ),
                          onChanged: (_) => _syncToRideProvider(),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.gps_fixed, size: 18, color: AppColors.primaryGreen),
                        onPressed: _detectCurrentLocation,
                      ),
                    ],
                  ),
                  const Divider(),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      TextButton.icon(
                        icon: const Icon(Icons.calendar_today, size: 18, color: AppColors.primaryDark),
                        label: Text(
                          '${_selectedDate.day}/${_selectedDate.month}/${_selectedDate.year}',
                          style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primaryDark),
                        ),
                        onPressed: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _selectedDate,
                            firstDate: DateTime.now(),
                            lastDate: DateTime.now().add(const Duration(days: 30)),
                          );
                          if (picked != null) {
                            setState(() => _selectedDate = picked);
                            _syncToRideProvider();
                          }
                        },
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.access_time, size: 18, color: AppColors.primaryDark),
                        label: Text(
                          _selectedTime.format(context),
                          style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primaryDark),
                        ),
                        onPressed: () async {
                          final picked = await showTimePicker(
                            context: context,
                            initialTime: _selectedTime,
                          );
                          if (picked != null) {
                            setState(() => _selectedTime = picked);
                            _syncToRideProvider();
                          }
                        },
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Number of Hours
            const Text('Booking Duration', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            Row(
              children: [2, 4, 8, 12].map((hrs) {
                final isSelected = _selectedHours == hrs;
                return Expanded(
                  child: GestureDetector(
                    onTap: () {
                      setState(() => _selectedHours = hrs);
                      _syncToRideProvider();
                    },
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: isSelected ? AppColors.primaryDark : Colors.grey[100],
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        children: [
                          Text(
                            '$hrs Hrs',
                            style: TextStyle(
                              color: isSelected ? Colors.white : Colors.black87,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Standby',
                            style: TextStyle(
                              color: isSelected ? Colors.amber : Colors.grey[600],
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 24),

            // Transparent Pricing Structure Box
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.grey[50],
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.grey[200]!),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Billing Structure', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Base Package ($_selectedHours hours standby)', style: TextStyle(color: Colors.grey[700], fontSize: 13)),
                      Text(
                        rideState.fareEstimate?.baseAmount != null
                            ? '₹${rideState.fareEstimate!.baseAmount.toStringAsFixed(2)}'
                            : (estimatedAdvance != null ? '₹${estimatedAdvance.toStringAsFixed(2)}' : 'Calculating...'),
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Configured Fuel Rate', style: TextStyle(color: Colors.grey[700], fontSize: 13)),
                      Text(
                        '₹${fuelRate.toStringAsFixed(2)} / km',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryGreen),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Fuel Cost Policy', style: TextStyle(color: Colors.grey, fontSize: 12)),
                      Text(
                        'Billed on actual GPS distance',
                        style: TextStyle(color: Colors.grey[600], fontSize: 12, fontStyle: FontStyle.italic),
                      ),
                    ],
                  ),
                  const Divider(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total Package Advance', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      Text(
                        estimatedAdvance != null
                            ? '₹${estimatedAdvance.toStringAsFixed(2)}'
                            : (rideState.isEstimatingFare ? 'Calculating...' : '--'),
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: AppColors.primaryDark),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // Book Button
            InfurnusButton(
              text: estimatedAdvance != null
                  ? 'Book Premium Vehicle • ₹${estimatedAdvance.toStringAsFixed(0)}'
                  : 'Book Premium Vehicle',
              isLoading: rideState.isEstimatingFare,
              onPressed: _fleetVehicles.isEmpty ? null : _handleBooking,
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}
