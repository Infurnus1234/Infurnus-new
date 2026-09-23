import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../../core/services/location_service.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../data/models/fleet_vehicle_model.dart';
import '../providers/ride_provider.dart';
import '../providers/ride_use_case_providers.dart';

class RentalsScreen extends ConsumerStatefulWidget {
  const RentalsScreen({super.key});

  @override
  ConsumerState<RentalsScreen> createState() => _RentalsScreenState();
}

class _RentalsScreenState extends ConsumerState<RentalsScreen> {
  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color borderCard = Color(0xFF262626);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color brandGreen = Color(0xFF22C55E);
  static const Color goldAccent = Color(0xFFFACC15);

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
        ref
            .read(rideProvider.notifier)
            .setPickupCoords(
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
    ref
        .read(rideProvider.notifier)
        .setRoute(
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
        return Icons.directions_car_filled_rounded;
      case 'thar':
        return Icons.terrain_rounded;
      case 'luxury_suv':
        return Icons.stars_rounded;
      default:
        return Icons.directions_car_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final car = _currentCar;
    final fuelRate = car?.fuelRatePerKm ?? 0.0;
    final estimatedAdvance = rideState.fare;

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Text(
          'Premium & Luxury Fleet',
          style: TextStyle(color: textWhite, fontWeight: FontWeight.bold),
        ),
        elevation: 0,
        backgroundColor: const Color(0xFF050505),
        foregroundColor: textWhite,
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
                color: cardBg,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: goldAccent.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1F1A00),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: goldAccent.withValues(alpha: 0.3),
                      ),
                    ),
                    child: const Icon(
                      Icons.stars_rounded,
                      color: goldAccent,
                      size: 28,
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Hourly Chauffeur Service',
                          style: TextStyle(
                            color: textWhite,
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Dedicated luxury vehicle with standby driver. Fuel billed on actual distance.',
                          style: TextStyle(color: textGray, fontSize: 12),
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
                const Text(
                  'Choose Your Vehicle',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: textWhite,
                  ),
                ),
                if (_isLoadingFleet)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: brandGreen,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),

            if (_isLoadingFleet)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: CircularProgressIndicator(color: brandGreen),
                ),
              )
            else if (_fleetError != null)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF3A1111),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: const Color(0xFFEF4444).withValues(alpha: 0.4),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: Color(0xFFEF4444)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Unable to load active fleet: $_fleetError',
                        style: const TextStyle(color: textWhite, fontSize: 13),
                      ),
                    ),
                    TextButton(
                      onPressed: _fetchFleet,
                      child: const Text(
                        'Retry',
                        style: TextStyle(color: brandGreen),
                      ),
                    ),
                  ],
                ),
              )
            else if (_fleetVehicles.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: cardBg,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: borderCard),
                ),
                child: const Column(
                  children: [
                    Icon(
                      Icons.directions_car_outlined,
                      size: 40,
                      color: textGray,
                    ),
                    SizedBox(height: 8),
                    Text(
                      'No premium vehicles currently available',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        color: textWhite,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'All luxury fleet units are currently on assignment.',
                      style: TextStyle(color: textGray, fontSize: 12),
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
                      color: isSelected ? const Color(0xFF1F1A00) : cardBg,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: isSelected ? goldAccent : borderCard,
                        width: isSelected ? 2 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 24,
                          backgroundColor: isSelected
                              ? goldAccent.withValues(alpha: 0.2)
                              : const Color(0xFF1A1A1A),
                          child: Icon(
                            icon,
                            color: isSelected ? goldAccent : textWhite,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${item.make} ${item.model}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                  color: textWhite,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${item.category.toUpperCase()} • Chauffeur Standby',
                                style: const TextStyle(
                                  color: textGray,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              '₹${item.fuelRatePerKm.toStringAsFixed(0)}/km',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                                color: goldAccent,
                              ),
                            ),
                            const SizedBox(height: 2),
                            const Text(
                              'fuel rate',
                              style: TextStyle(fontSize: 11, color: textGray),
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
            const Text(
              'Trip Schedule & Pickup',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: textWhite,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: cardBg,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: borderCard),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.location_on_rounded,
                        color: Color(0xFFEF4444),
                        size: 20,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _pickupController,
                          style: const TextStyle(color: textWhite),
                          decoration: const InputDecoration(
                            hintText: 'Pickup Location',
                            hintStyle: TextStyle(color: textGray),
                            border: InputBorder.none,
                            isDense: true,
                          ),
                          onChanged: (_) => _syncToRideProvider(),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.gps_fixed_rounded,
                          size: 18,
                          color: brandGreen,
                        ),
                        onPressed: _detectCurrentLocation,
                      ),
                    ],
                  ),
                  const Divider(color: borderCard),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      TextButton.icon(
                        icon: const Icon(
                          Icons.calendar_today_rounded,
                          size: 18,
                          color: brandGreen,
                        ),
                        label: Text(
                          '${_selectedDate.day}/${_selectedDate.month}/${_selectedDate.year}',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            color: textWhite,
                          ),
                        ),
                        onPressed: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _selectedDate,
                            firstDate: DateTime.now(),
                            lastDate: DateTime.now().add(
                              const Duration(days: 30),
                            ),
                          );
                          if (picked != null) {
                            setState(() => _selectedDate = picked);
                            _syncToRideProvider();
                          }
                        },
                      ),
                      TextButton.icon(
                        icon: const Icon(
                          Icons.access_time_rounded,
                          size: 18,
                          color: brandGreen,
                        ),
                        label: Text(
                          _selectedTime.format(context),
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            color: textWhite,
                          ),
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
            const Text(
              'Booking Duration',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: textWhite,
              ),
            ),
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
                        color: isSelected ? const Color(0xFF1F1A00) : cardBg,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isSelected ? goldAccent : borderCard,
                        ),
                      ),
                      child: Column(
                        children: [
                          Text(
                            '$hrs Hrs',
                            style: TextStyle(
                              color: isSelected ? goldAccent : textWhite,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Standby',
                            style: TextStyle(
                              color: isSelected ? goldAccent : textGray,
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
                color: cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: borderCard),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Billing Structure',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: textWhite,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Base Package ($_selectedHours hours standby)',
                        style: const TextStyle(color: textGray, fontSize: 13),
                      ),
                      Text(
                        rideState.fareEstimate?.baseAmount != null
                            ? '₹${rideState.fareEstimate!.baseAmount.toStringAsFixed(2)}'
                            : (estimatedAdvance != null
                                  ? '₹${estimatedAdvance.toStringAsFixed(2)}'
                                  : 'Calculating...'),
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                          color: textWhite,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Configured Fuel Rate',
                        style: TextStyle(color: textGray, fontSize: 13),
                      ),
                      Text(
                        '₹${fuelRate.toStringAsFixed(2)} / km',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                          color: goldAccent,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Fuel Cost Policy',
                        style: TextStyle(color: textGray, fontSize: 12),
                      ),
                      Text(
                        'Billed on actual GPS distance',
                        style: TextStyle(
                          color: textGray.withValues(alpha: 0.8),
                          fontSize: 12,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 20, color: borderCard),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total Package Advance',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                          color: textWhite,
                        ),
                      ),
                      Text(
                        estimatedAdvance != null
                            ? '₹${estimatedAdvance.toStringAsFixed(2)}'
                            : (rideState.isEstimatingFare
                                  ? 'Calculating...'
                                  : '--'),
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 20,
                          color: brandGreen,
                        ),
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
