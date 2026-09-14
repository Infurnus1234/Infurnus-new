import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';

class SupportScreen extends StatelessWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Help & Support')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _buildSupportHeader(),
          const SizedBox(height: 24),
          const Text('Top FAQs', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          _faqItem('How do I book a ride?', 'To book a ride, enter your destination on the home screen...'),
          _faqItem('What are the rental charges?', 'Rental charges vary by vehicle type and duration...'),
          _faqItem('How to track my package?', 'You can track your package in real-time from the bookings section.'),
          const SizedBox(height: 24),
          const Text('Still need help?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          _buildContactOptions(context),
        ],
      ),
    );
  }

  Widget _buildSupportHeader() {
    return InfurnusCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          const Icon(Icons.support_agent, size: 64, color: AppColors.primaryGreen),
          const SizedBox(height: 16),
          const Text('Hello, how can we help?', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('Search for topics or contact us', style: TextStyle(color: Colors.grey[600])),
        ],
      ),
    );
  }

  Widget _faqItem(String question, String answer) {
    return ExpansionTile(
      title: Text(question, style: const TextStyle(fontWeight: FontWeight.w600)),
      children: [
        Padding(
          padding: const EdgeInsets.all(16.0),
          child: Text(answer),
        ),
      ],
    );
  }

  Widget _buildContactOptions(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _contactCard(Icons.chat_outlined, 'Chat with us', () {})),
        const SizedBox(width: 16),
        Expanded(child: _contactCard(Icons.email_outlined, 'Email support', () {})),
      ],
    );
  }

  Widget _contactCard(IconData icon, String label, VoidCallback onTap) {
    return InfurnusCard(
      onTap: onTap,
      child: Column(
        children: [
          Icon(icon, color: AppColors.primaryGreen),
          const SizedBox(height: 8),
          Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
