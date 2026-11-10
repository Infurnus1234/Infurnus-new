import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';

class SupportScreen extends StatelessWidget {
  static const String supportEmail = 'support@infurnuslogistics.com';

  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Help & Support')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _buildSupportHeader(context),
          const SizedBox(height: 24),
          const Text(
            'Top FAQs',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _faqItem(
            'How do I book a ride?',
            'To book a ride, enter your destination on the home screen and select your preferred vehicle tier.',
          ),
          _faqItem(
            'What are the rental charges?',
            'Rental charges vary by vehicle type, duration, and distance. You can view transparent estimates before booking.',
          ),
          _faqItem(
            'How to track my package?',
            'You can track logistics and package deliveries in real-time from the Activity section.',
          ),
          const SizedBox(height: 24),
          const Text(
            'Still need help?',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildEmailSupportBanner(context),
          const SizedBox(height: 12),
          _buildInAppChatCard(context),
        ],
      ),
    );
  }

  Widget _buildSupportHeader(BuildContext context) {
    return InfurnusCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          const Icon(
            Icons.support_agent,
            size: 64,
            color: AppColors.primaryGreen,
          ),
          const SizedBox(height: 16),
          const Text(
            'INFURNUS Help Center',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'We are here 24/7 to assist you with your rides & logistics',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey[600], fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailSupportBanner(BuildContext context) {
    return InfurnusCard(
      onTap: () => _emailSupport(context),
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.primaryGreen.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.email_outlined,
              color: AppColors.primaryGreen,
              size: 28,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Email Support',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF111827),
                  ),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  supportEmail,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.primaryGreen,
                  ),
                  onTap: () => _emailSupport(context),
                ),
                const SizedBox(height: 2),
                Text(
                  'Tap to open email client (mailto:$supportEmail)',
                  style: TextStyle(color: Colors.grey[500], fontSize: 11),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.arrow_forward_ios_rounded,
            size: 16,
            color: Color(0xFF9CA3AF),
          ),
        ],
      ),
    );
  }

  Widget _faqItem(String question, String answer) {
    return ExpansionTile(
      title: Text(
        question,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      children: [
        Padding(padding: const EdgeInsets.all(16.0), child: Text(answer)),
      ],
    );
  }

  Widget _buildInAppChatCard(BuildContext context) {
    return InfurnusCard(
      onTap: () => context.push('/support-tickets'),
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.primaryGreen.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.chat_outlined,
              color: AppColors.primaryGreen,
              size: 28,
            ),
          ),
          const SizedBox(width: 14),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'In-App Chat',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF111827),
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  'Create and track support tickets with our team',
                  style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.arrow_forward_ios_rounded,
            size: 16,
            color: Color(0xFF9CA3AF),
          ),
        ],
      ),
    );
  }

  static Future<void> _emailSupport(BuildContext context) async {
    final emailUri = Uri(
      scheme: 'mailto',
      path: supportEmail,
      queryParameters: {'subject': 'INFURNUS Help & Support Inquiry'},
    );

    try {
      if (await launchUrl(emailUri, mode: LaunchMode.externalApplication)) {
        return;
      }
    } catch (_) {}

    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Opening email client... If no email app is installed, please contact us via Support Tickets.',
        ),
      ),
    );
    context.push('/support-tickets');
  }
}
