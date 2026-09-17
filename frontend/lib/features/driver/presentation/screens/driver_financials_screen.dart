import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';

class DriverFinancialsScreen extends StatelessWidget {
  const DriverFinancialsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Earnings & History'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            InfurnusCard(
              child: Column(
                children: [
                  const Icon(
                    Icons.account_balance_wallet_outlined,
                    size: 48,
                    color: Colors.orange,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Financials & History Unavailable',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Driver ride history, earnings, and wallet tracking are not supported by the current backend contract.',
                    style: TextStyle(color: Colors.grey[600], fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.info_outline, size: 20, color: AppColors.primaryDark),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Requires backend API endpoints for /rides/driver/history and /driver/earnings.',
                            style: TextStyle(fontSize: 12, color: AppColors.textPrimary),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
