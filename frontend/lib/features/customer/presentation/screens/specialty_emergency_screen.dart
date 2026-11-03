import 'package:flutter/material.dart';

import '../widgets/configured_vehicle_screen.dart';

class SpecialtyEmergencyScreen extends StatelessWidget {
  const SpecialtyEmergencyScreen({super.key});
  @override
  Widget build(BuildContext context) => const ConfiguredVehicleScreen(
    title: 'Specialty & Emergency',
    sector: 'service',
  );
}
