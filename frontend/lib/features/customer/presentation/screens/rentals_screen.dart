import 'package:flutter/material.dart';

import '../widgets/configured_vehicle_screen.dart';

class RentalsScreen extends StatelessWidget {
  const RentalsScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      const ConfiguredVehicleScreen(title: 'Rental', sector: 'rental');
}
