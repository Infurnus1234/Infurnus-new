import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

class RentalsScreen extends StatelessWidget {
  const RentalsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rentals')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _rentalItem('Economy Sedan', '₹1,200/day', '4 Seats • Manual'),
          _rentalItem('Premium SUV', '₹2,500/day', '7 Seats • Automatic'),
          _rentalItem('Luxury Coupe', '₹5,000/day', '2 Seats • Sport'),
        ],
      ),
    );
  }

  Widget _rentalItem(String name, String price, String specs) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: const Icon(Icons.key, color: AppColors.primaryGreen, size: 40),
        title: Text(name, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(specs),
        trailing: Text(price, style: const TextStyle(color: AppColors.primaryGreen, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
