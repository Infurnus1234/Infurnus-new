import 'package:flutter/material.dart';

import '../widgets/configured_vehicle_screen.dart';

class LogisticsScreen extends StatelessWidget {
  const LogisticsScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      const ConfiguredVehicleScreen(title: 'Logistics', sector: 'logistics');
}
