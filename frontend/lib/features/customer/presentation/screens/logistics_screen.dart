import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../providers/ride_provider.dart';

class LogisticsScreen extends ConsumerStatefulWidget {
  const LogisticsScreen({super.key});

  @override
  ConsumerState<LogisticsScreen> createState() => _LogisticsScreenState();
}

class _LogisticsScreenState extends ConsumerState<LogisticsScreen> {
  final _pickupController = TextEditingController();
  final _dropController = TextEditingController();
  final _itemDescController = TextEditingController();
  final _weightController = TextEditingController(text: '15');
  final _quantityController = TextEditingController(text: '1');

  String _selectedVehicle = 'mini_truck'; // 'bike', 'three_wheeler', 'mini_truck'
  String _selectedCategory = 'General Goods';
  bool _needLoadingHelper = false;

  final List<String> _categories = [
    'General Goods',
    'Electronics & Gadgets',
    'Furniture & Home',
    'Documents & Legal',
    'Machinery & Spares',
  ];

  @override
  void initState() {
    super.initState();
    final rideState = ref.read(rideProvider);
    _pickupController.text = rideState.pickup ?? '';
    _dropController.text = rideState.destination ?? '';
    _itemDescController.text = '';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _detectCurrentLocation();
      _recalculateFare();
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
        _recalculateFare();
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _pickupController.dispose();
    _dropController.dispose();
    _itemDescController.dispose();
    _weightController.dispose();
    _quantityController.dispose();
    super.dispose();
  }

  void _recalculateFare() {
    final weight = double.tryParse(_weightController.text.trim()) ?? 15.0;
    final qty = int.tryParse(_quantityController.text.trim()) ?? 1;

    ref.read(rideProvider.notifier).setRoute(
          _pickupController.text.trim(),
          _dropController.text.trim(),
        );
    ref.read(rideProvider.notifier).selectSector('logistics');
    ref.read(rideProvider.notifier).selectTier(_selectedVehicle);
    ref.read(rideProvider.notifier).setGoods({
      'itemType': _selectedCategory,
      'description': _itemDescController.text.trim(),
      'weightKg': weight,
      'quantity': qty,
      'loadingAssistance': _needLoadingHelper,
    });
  }

  void _handleBooking() {
    if (_pickupController.text.trim().isEmpty || _dropController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter pickup and delivery addresses')),
      );
      return;
    }

    _recalculateFare();
    ref.read(rideProvider.notifier).requestRide();
    context.push('/ride-booking');
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final estimate = rideState.fareEstimate;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Logistics & Freight'),
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header info pill
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.orange[50],
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.orange[200]!),
              ),
              child: Row(
                children: [
                  Icon(Icons.local_shipping, color: Colors.orange[800], size: 24),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'On-demand intra-city freight with live GPS tracking and verified cargo drivers.',
                      style: TextStyle(color: Colors.orange[900], fontSize: 12, fontWeight: FontWeight.w500),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Route addresses
            const Text('Pickup & Delivery Location', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.grey[50],
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.grey[200]!),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Icon(Icons.upload, color: AppColors.primaryGreen, size: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _pickupController,
                          decoration: const InputDecoration(
                            hintText: 'Pickup Address (Warehouse / Shop / Home)',
                            border: InputBorder.none,
                            isDense: true,
                          ),
                          onChanged: (_) => _recalculateFare(),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.gps_fixed, size: 18, color: AppColors.primaryGreen),
                        onPressed: _detectCurrentLocation,
                      ),
                    ],
                  ),
                  const Divider(height: 16),
                  Row(
                    children: [
                      const Icon(Icons.download, color: Colors.orange, size: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _dropController,
                          decoration: const InputDecoration(
                            hintText: 'Delivery Destination Address',
                            border: InputBorder.none,
                            isDense: true,
                          ),
                          onChanged: (_) => _recalculateFare(),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Vehicle Category Selector
            const Text('Select Freight Vehicle', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            Row(
              children: [
                _buildVehicleOption(
                  id: 'bike',
                  title: 'Bike Express',
                  capacity: 'Up to 20 kg',
                  icon: Icons.two_wheeler,
                ),
                const SizedBox(width: 10),
                _buildVehicleOption(
                  id: 'three_wheeler',
                  title: '3-Wheeler',
                  capacity: 'Up to 300 kg',
                  icon: Icons.electric_rickshaw,
                ),
                const SizedBox(width: 10),
                _buildVehicleOption(
                  id: 'mini_truck',
                  title: 'Mini Truck 1T',
                  capacity: 'Up to 1000 kg',
                  icon: Icons.local_shipping,
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Item Details
            const Text('Cargo & Parcel Information', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            InfurnusCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: _selectedCategory,
                    decoration: const InputDecoration(
                      labelText: 'Item Category',
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    ),
                    items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c, style: const TextStyle(fontSize: 14)))).toList(),
                    onChanged: (val) {
                      if (val != null) {
                        setState(() => _selectedCategory = val);
                        _recalculateFare();
                      }
                    },
                  ),
                  const SizedBox(height: 14),
                  InfurnusTextField(
                    label: 'Goods Description',
                    hintText: 'e.g. 2 boxes of fragile glassware',
                    controller: _itemDescController,
                    onChanged: (_) => _recalculateFare(),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: InfurnusTextField(
                          label: 'Estimated Weight (kg)',
                          hintText: 'e.g. 45',
                          keyboardType: TextInputType.number,
                          controller: _weightController,
                          onChanged: (_) => _recalculateFare(),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: InfurnusTextField(
                          label: 'Quantity / Units',
                          hintText: 'e.g. 2',
                          keyboardType: TextInputType.number,
                          controller: _quantityController,
                          onChanged: (_) => _recalculateFare(),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Driver Loading & Unloading Help', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    subtitle: const Text('Helper assistance for heavy goods (server rate applies)', style: TextStyle(fontSize: 12, color: Colors.grey)),
                    value: _needLoadingHelper,
                    activeThumbColor: AppColors.primaryGreen,
                    onChanged: (val) {
                      setState(() => _needLoadingHelper = val);
                      _recalculateFare();
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Itemized Fare Breakdown Card
            const Text('Itemized Fare Breakdown', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.grey[50],
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.grey[200]!),
              ),
              child: Column(
                children: [
                  if (estimate == null) ...[
                    _buildFareRow('Status', 'Fare estimate calculating...'),
                  ] else ...[
                    _buildFareRow('Base Logistics Charge', '₹${estimate.baseAmount.toStringAsFixed(2)}'),
                    const SizedBox(height: 6),
                    _buildFareRow(
                      'Distance Charge (${estimate.distanceKm.toStringAsFixed(1)} km)',
                      '₹${estimate.distanceAmount.toStringAsFixed(2)}',
                    ),
                    if ((estimate.weightAmount ?? 0) > 0) ...[
                      const SizedBox(height: 6),
                      _buildFareRow('Weight Surcharge (>20kg)', '₹${estimate.weightAmount!.toStringAsFixed(2)}'),
                    ],
                    if (_needLoadingHelper && (estimate.loadingAmount ?? 0) > 0) ...[
                      const SizedBox(height: 6),
                      _buildFareRow('Loading/Unloading Helper', '₹${estimate.loadingAmount!.toStringAsFixed(2)}'),
                    ],
                    if ((estimate.taxAmount ?? 0) > 0) ...[
                      const SizedBox(height: 6),
                      _buildFareRow('Goods & Service Tax (5% GST)', '₹${estimate.taxAmount!.toStringAsFixed(2)}'),
                    ],
                  ],
                  const Divider(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total Estimated Fare', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text(
                        rideState.fare != null
                            ? '₹${rideState.fare!.toStringAsFixed(2)}'
                            : (estimate != null ? '₹${estimate.grossAmount.toStringAsFixed(2)}' : '--'),
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: AppColors.primaryGreen),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // Book Button
            InfurnusButton(
              text: rideState.fare != null
                  ? 'Book Logistics Delivery • ₹${rideState.fare!.toStringAsFixed(0)}'
                  : 'Book Logistics Delivery',
              isLoading: rideState.isEstimatingFare,
              onPressed: _handleBooking,
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildVehicleOption({
    required String id,
    required String title,
    required String capacity,
    required IconData icon,
  }) {
    final isSelected = _selectedVehicle == id;

    return Expanded(
      child: GestureDetector(
        onTap: () {
          setState(() => _selectedVehicle = id);
          _recalculateFare();
        },
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: isSelected ? Colors.orange[50] : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? Colors.orange : Colors.grey[300]!,
              width: isSelected ? 2 : 1,
            ),
          ),
          child: Column(
            children: [
              Icon(icon, size: 28, color: isSelected ? Colors.orange[800] : Colors.grey[700]),
              const SizedBox(height: 6),
              Text(
                title,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 2),
              Text(
                capacity,
                style: TextStyle(fontSize: 10, color: Colors.grey[600]),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFareRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: Colors.grey[700], fontSize: 13)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
      ],
    );
  }
}
