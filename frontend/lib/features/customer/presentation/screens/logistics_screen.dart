import 'package:flutter/material.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';

class LogisticsScreen extends StatelessWidget {
  const LogisticsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Logistics & Delivery')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const InfurnusTextField(label: 'Pickup Address', hintText: 'Enter pickup location', prefixIcon: Icons.upload),
            const SizedBox(height: 16),
            const InfurnusTextField(label: 'Delivery Address', hintText: 'Enter drop location', prefixIcon: Icons.download),
            const SizedBox(height: 16),
            const InfurnusTextField(label: 'Package Details', hintText: 'Weight, item type, etc.'),
            const SizedBox(height: 40),
            InfurnusButton(text: 'Check Delivery Price', onPressed: () {}),
          ],
        ),
      ),
    );
  }
}
