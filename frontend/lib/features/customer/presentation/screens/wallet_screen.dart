import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_empty_state.dart';
import '../providers/ride_provider.dart';

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color borderCard = Color(0xFF262626);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color brandGreen = Color(0xFF22C55E);

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
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Text(
          'INFURNUS Wallet & Pay',
          style: TextStyle(color: textWhite, fontWeight: FontWeight.bold),
        ),
        elevation: 0,
        backgroundColor: const Color(0xFF050505),
        foregroundColor: textWhite,
      ),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildBalanceCard(payments),
            const SizedBox(height: 28),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Recent Transactions',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: textWhite,
                  ),
                ),
                Text(
                  '${payments.length} items',
                  style: const TextStyle(color: textGray, fontSize: 13),
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

  Widget _buildBalanceCard(List<Map<String, dynamic>> payments) {
    final totalSpent = payments.fold<double>(
      0.0,
      (sum, tx) => sum + ((tx['amount'] as num?)?.toDouble() ?? 0.0),
    );

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderCard),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.5),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          const Text(
            'Wallet Balance',
            style: TextStyle(color: textGray, fontSize: 15),
          ),
          const SizedBox(height: 8),
          const Text(
            '₹0.00',
            style: TextStyle(
              color: textWhite,
              fontSize: 36,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (totalSpent > 0) ...[
            const SizedBox(height: 4),
            Text(
              'Total Lifetime Settled: ₹${totalSpent.toStringAsFixed(2)}',
              style: const TextStyle(color: textGray, fontSize: 12),
            ),
          ],
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              InfurnusButton(
                text: '+ Add Money',
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'UPI / Net Banking top-up gateway initiated',
                      ),
                    ),
                  );
                },
                isFullWidth: false,
              ),
              const SizedBox(width: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.qr_code, color: textWhite, size: 18),
                label: const Text(
                  'Scan & Pay',
                  style: TextStyle(color: textWhite),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: borderCard),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
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
    return const InfurnusEmptyState(
      icon: Icons.receipt_long_rounded,
      title: 'No transactions yet',
      description: 'Your ride, logistics and rental payments will appear here.',
    );
  }

  Widget _buildTransactionList(List<Map<String, dynamic>> payments) {
    return ListView.separated(
      itemCount: payments.length,
      separatorBuilder: (_, __) => const Divider(height: 1, color: borderCard),
      itemBuilder: (context, index) {
        final tx = payments[index];
        final amount = (tx['amount'] as num?)?.toDouble() ?? 0.0;
        final method =
            tx['payment_method']?.toString().toUpperCase() ?? 'WALLET';
        final status = tx['status']?.toString() ?? 'completed';
        final date = tx['created_at']?.toString().split('T').first ?? 'Recent';

        return ListTile(
          contentPadding: const EdgeInsets.symmetric(vertical: 6),
          leading: CircleAvatar(
            backgroundColor: status == 'completed'
                ? brandGreen.withValues(alpha: 0.15)
                : const Color(0xFF3A290A),
            child: Icon(
              Icons.directions_car_rounded,
              color: status == 'completed'
                  ? brandGreen
                  : const Color(0xFFF59E0B),
            ),
          ),
          title: Text(
            'Mobility Fare ($method)',
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: textWhite,
            ),
          ),
          subtitle: Text(
            '$date • ${status.toUpperCase()}',
            style: const TextStyle(color: textGray, fontSize: 12),
          ),
          trailing: Text(
            '-₹${amount.toStringAsFixed(2)}',
            style: const TextStyle(
              fontWeight: FontWeight.w900,
              color: Color(0xFFEF4444),
              fontSize: 14,
            ),
          ),
        );
      },
    );
  }
}
