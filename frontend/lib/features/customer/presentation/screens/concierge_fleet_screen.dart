import 'package:flutter/material.dart';

import '../widgets/configured_vehicle_screen.dart';

class ConciergeFleetScreen extends StatelessWidget {
  const ConciergeFleetScreen({super.key});
  @override
  Widget build(BuildContext context) => const ConfiguredVehicleScreen(
    title: 'The Concierge Fleet',
    sector: 'premium',
  );
}
