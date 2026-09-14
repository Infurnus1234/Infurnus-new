import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';

class DriverOnboardingScreen extends StatelessWidget {
  const DriverOnboardingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Become a Partner')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Complete your KYC to start earning', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            _buildDocStatusCard('Driving License', 'Pending Upload', Icons.assignment_ind),
            const SizedBox(height: 16),
            _buildDocStatusCard('Vehicle Registration (RC)', 'Not Started', Icons.directions_car),
            const SizedBox(height: 16),
            _buildDocStatusCard('Insurance Policy', 'Not Started', Icons.security),
            const SizedBox(height: 16),
            _buildDocStatusCard('Aadhaar / PAN Card', 'Not Started', Icons.badge),
            const SizedBox(height: 40),
            InfurnusButton(
              text: 'Submit for Approval',
              onPressed: () {
                // Show success dialog
                showDialog(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Submitted'),
                    content: const Text('Your documents are under review. We will notify you once approved.'),
                    actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDocStatusCard(String title, String status, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey[300]!),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.primaryGreen, size: 30),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
                Text(status, style: TextStyle(color: Colors.grey[600], fontSize: 12)),
              ],
            ),
          ),
          const Icon(Icons.file_upload_outlined, color: Colors.grey),
        ],
      ),
    );
  }
}
