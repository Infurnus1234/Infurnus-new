import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../providers/ride_provider.dart';

class RentalsScreen extends ConsumerStatefulWidget {
  const RentalsScreen({super.key});

  @override
  ConsumerState<RentalsScreen> createState() => _RentalsScreenState();
}

class _RentalsScreenState extends ConsumerState<RentalsScreen> {
  final _pickupController = TextEditingController(text: 'JW Marriott, Vittal Mallya Road');
  String _selectedVehicle = 'fortuner';
  int _selectedHours = 4;
  DateTime _selectedDate = DateTime.now();
  TimeOfDay _selectedTime = const TimeOfDay(hour: 10, minute: 0);

  final List<Map<String, dynamic>> _fleet = [
    {
      'id': 'fortuner',
      'name': 'Toyota Fortuner',
      'tagline': 'Luxury 4x4 • 7 Seater',
      'hourlyRate': 1200.0,
      'fuelRate': 16.0,
      'features': 'Leather Interior • Chauffeur • High Clearance',
      'icon': Icons.directions_car,
    },
    {
      'id': 'thar',
      'name': 'Mahindra Thar',
      'tagline': 'Adventure 4x4 • 4 Seater',
      'hourlyRate': 950.0,
      'fuelRate': 14.0,
      'features': 'Convertible Roof • All-Terrain • Iconic Stance',
      'icon': Icons.terrain,
    },
    {
      'id': 'luxury_suv',
      'name': 'BMW / Mercedes SUV',
      'tagline': 'VIP Executive • 5 Seater',
      'hourlyRate': 2200.0,
      'fuelRate': 22.0,
      'features': 'Panoramic Sunroof • Executive Lounge • Butler Service',
      'icon': Icons.stars,
    },
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _detectCurrentLocation();
      _syncToRideProvider();
    });
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

  Map<String, dynamic> get _currentCar =>
      _fleet.firstWhere((c) => c['id'] == _selectedVehicle, orElse: () => _fleet.first);

  void _syncToRideProvider() {
    final car = _currentCar;
    ref.read(rideProvider.notifier).setRoute(
          _pickupController.text.trim(),
          'Hourly Standby / As Directed',
        );
    ref.read(rideProvider.notifier).selectSector('premium');
    ref.read(rideProvider.notifier).selectTier(_selectedVehicle);
    ref.read(rideProvider.notifier).setRentalDetails({
      'hours': _selectedHours,
      'startDate': '${_selectedDate.year}-${_selectedDate.month.toString().padLeft(2, '0')}-${_selectedDate.day.toString().padLeft(2, '0')}',
      'startTime': '${_selectedTime.hour}:${_selectedTime.minute.toString().padLeft(2, '0')}',
      'fuelRatePerKm': car['fuelRate'] as double,
      'vehicleModel': car['name'] as String,
    });
  }

  void _handleBooking() {
    if (_pickupController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter pickup location')),
      );
      return;
    }

    _syncToRideProvider();
    ref.read(rideProvider.notifier).requestRide();
    context.push('/ride-booking');
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final car = _currentCar;
    final hourlyRate = car['hourlyRate'] as double;
    final fuelRate = car['fuelRate'] as double;
    final basePackageFare = hourlyRate * _selectedHours;

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
            const Text('Choose Your Vehicle', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            ..._fleet.map((item) {
              final isSelected = item['id'] == _selectedVehicle;
              return GestureDetector(
                onTap: () {
                  setState(() => _selectedVehicle = item['id'] as String);
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
                        child: Icon(item['icon'] as IconData, color: isSelected ? Colors.amber[900] : Colors.grey[800]),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(item['name'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                            const SizedBox(height: 2),
                            Text(item['tagline'] as String, style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                            const SizedBox(height: 4),
                            Text(
                              item['features'] as String,
                              style: TextStyle(color: Colors.grey[500], fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            '₹${(item['hourlyRate'] as double).toStringAsFixed(0)}/hr',
                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.amber[900]),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '+₹${(item['fuelRate'] as double).toStringAsFixed(0)}/km fuel',
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
                            '₹${(hourlyRate * hrs).toStringAsFixed(0)}',
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
                      Text('₹${basePackageFare.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Configured Fuel Rate', style: TextStyle(color: Colors.grey[700], fontSize: 13)),
                      Text('₹${fuelRate.toStringAsFixed(2)} / km', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryGreen)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Fuel Cost Policy', style: TextStyle(color: Colors.grey, fontSize: 12)),
                      Text('Billed on actual GPS distance', style: TextStyle(color: Colors.grey[600], fontSize: 12, fontStyle: FontStyle.italic)),
                    ],
                  ),
                  const Divider(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total Package Advance', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      Text(
                        '₹${basePackageFare.toStringAsFixed(2)}',
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
              text: 'Book Premium Vehicle • ₹${basePackageFare.toStringAsFixed(0)}',
              isLoading: rideState.isEstimatingFare,
              onPressed: _handleBooking,
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}
