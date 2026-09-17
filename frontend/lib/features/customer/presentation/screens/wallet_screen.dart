import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../providers/ride_provider.dart';

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(rideProvider.notifier).fetchPaymentHistory();
    });
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final payments = rideState.recentPayments;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('INFURNUS Wallet & Pay'),
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
      ),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildBalanceCard(),
            const SizedBox(height: 28),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Recent Transactions', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                Text(
                  '${payments.length} items',
                  style: TextStyle(color: Colors.grey[600], fontSize: 13),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Expanded(
              child: payments.isEmpty
                  ? _buildEmptyTransactions()
                  : _buildTransactionList(payments),
            ),
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
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: 0.3),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          const Text('Total Balance', style: TextStyle(color: Colors.white70, fontSize: 15)),
          const SizedBox(height: 8),
          const Text('₹2,450.00', style: TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              InfurnusButton(
                text: '+ Add Money',
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('UPI / Net Banking top-up gateway initiated')),
                  );
                },
                isFullWidth: false,
              ),
              const SizedBox(width: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.qr_code, color: Colors.white, size: 18),
                label: const Text('Scan & Pay', style: TextStyle(color: Colors.white)),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.white38),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                ),
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Scan QR code to pay')),
                  );
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyTransactions() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.receipt_long_outlined, size: 56, color: Colors.grey[400]),
          const SizedBox(height: 12),
          const Text('No transactions yet', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 4),
          Text(
            'Your ride, logistics and rental payments will appear here.',
            style: TextStyle(color: Colors.grey[600], fontSize: 13),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionList(List<Map<String, dynamic>> payments) {
    return ListView.separated(
      itemCount: payments.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final tx = payments[index];
        final amount = (tx['amount'] as num?)?.toDouble() ?? 0.0;
        final method = tx['payment_method']?.toString().toUpperCase() ?? 'WALLET';
        final status = tx['status']?.toString() ?? 'completed';
        final date = tx['created_at']?.toString().split('T').first ?? 'Recent';

        return ListTile(
          contentPadding: const EdgeInsets.symmetric(vertical: 6),
          leading: CircleAvatar(
            backgroundColor: status == 'completed' ? Colors.green[50] : Colors.amber[50],
            child: Icon(
              Icons.directions_car,
              color: status == 'completed' ? AppColors.primaryGreen : Colors.amber[800],
            ),
          ),
          title: Text(
            'Mobility Fare ($method)',
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          ),
          subtitle: Text(
            '$date • ${status.toUpperCase()}',
            style: TextStyle(color: Colors.grey[600], fontSize: 12),
          ),
          trailing: Text(
            '-₹${amount.toStringAsFixed(2)}',
            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.redAccent, fontSize: 14),
          ),
        );
      },
    );
  }
}
