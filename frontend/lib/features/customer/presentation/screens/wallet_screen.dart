import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Wallet'), elevation: 0),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildBalanceCard(),
            const SizedBox(height: 32),
            const Text('Recent Transactions', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Expanded(child: _buildTransactionList()),
          ],
        ),
      ),
    );
  }

  Widget _buildBalanceCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.primaryDark,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        children: [
          const Text('Total Balance', style: TextStyle(color: Colors.white70, fontSize: 16)),
          const SizedBox(height: 8),
          const Text('₹1,250.00', style: TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          InfurnusButton(
            text: 'Add Money',
            onPressed: () {},
            isFullWidth: false,
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionList() {
    return ListView.separated(
      itemCount: 5,
      separatorBuilder: (_, __) => const Divider(),
      itemBuilder: (context, index) {
        return ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const CircleAvatar(backgroundColor: Colors.grey, child: Icon(Icons.directions_car, color: Colors.white)),
          title: const Text('Ride to Airport', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text('Oct 12, 2023 • 10:30 AM'),
          trailing: const Text('-₹250.00', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.red)),
        );
      },
    );
  }
}
