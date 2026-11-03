import 'package:flutter/material.dart';

import '../widgets/configured_vehicle_screen.dart';

class PassengerRidesScreen extends StatelessWidget {
  const PassengerRidesScreen({super.key});
  @override
  Widget build(BuildContext context) => const ConfiguredVehicleScreen(
    title: 'Passenger Rides',
    sector: 'passenger',
  );
}
