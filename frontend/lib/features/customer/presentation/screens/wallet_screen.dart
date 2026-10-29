import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../core/services/upi_payment_service.dart';
import '../providers/ride_provider.dart';

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  static const Color mainBg = Color(0xFFF8FAFC);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE2E8F0);
  static const Color textBlack = Color(0xFF0F172A);
  static const Color textGray = Color(0xFF64748B);
  static const Color brandGreen = Color(0xFF10B981);
  static const Color darkGreen = Color(0xFF065F46);

  String _filter = 'all'; // 'all', 'debit', 'credit'
  double _walletBalance = 850.00;
  bool _isLoading = false;

  final List<Map<String, dynamic>> _mockCredits = [
    {
      'id': 'topup_001',
      'amount': 1000.00,
      'type': 'credit',
      'payment_method': 'UPI (Google Pay)',
      'status': 'completed',
      'title': 'Wallet Top-Up',
      'created_at': DateTime.now()
          .subtract(const Duration(days: 1))
          .toIso8601String(),
    },
    {
      'id': 'topup_002',
      'amount': 250.00,
      'type': 'credit',
      'payment_method': 'Cashback Bonus',
      'status': 'completed',
      'title': 'Promotional Cashback',
      'created_at': DateTime.now()
          .subtract(const Duration(days: 3))
          .toIso8601String(),
    },
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    await ref.read(rideProvider.notifier).fetchPaymentHistory();
    if (mounted) setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final serverPayments = rideState.recentPayments;

    // Combine server payments with top-up credits
    final List<Map<String, dynamic>> allTransactions = [
      ..._mockCredits,
      ...serverPayments.map(
        (p) => {
          'id': p['id']?.toString() ?? 'tx_${p.hashCode}',
          'amount': (p['amount'] as num?)?.toDouble() ?? 0.0,
          'type': 'debit',
          'payment_method':
              p['provider']?.toString().toUpperCase() ??
              p['payment_method']?.toString().toUpperCase() ??
              'UPI / CARD',
          'status':
              (p['status']?.toString().toLowerCase() == 'captured' ||
                  p['status']?.toString().toLowerCase() == 'completed')
              ? 'completed'
              : (p['status']?.toString().toLowerCase() ?? 'completed'),
          'title': p['rideId'] != null
              ? 'Mobility Fare Payment'
              : 'Service Payment',
          'created_at':
              p['createdAt']?.toString() ??
              p['created_at']?.toString() ??
              DateTime.now().toIso8601String(),
        },
      ),
    ];

    // Sort newest first
    allTransactions.sort((a, b) {
      final dateA =
          DateTime.tryParse(a['created_at']?.toString() ?? '') ??
          DateTime.now();
      final dateB =
          DateTime.tryParse(b['created_at']?.toString() ?? '') ??
          DateTime.now();
      return dateB.compareTo(dateA);
    });

    final filtered = allTransactions.where((tx) {
      if (_filter == 'debit') return tx['type'] == 'debit';
      if (_filter == 'credit') return tx['type'] == 'credit';
      return true;
    }).toList();

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'INFURNUS Wallet & Pay',
              style: TextStyle(
                color: textBlack,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
            Text(
              'Instant payments, balance & QR scan',
              style: TextStyle(
                color: textGray,
                fontSize: 12,
                fontWeight: FontWeight.normal,
              ),
            ),
          ],
        ),
        elevation: 0.5,
        backgroundColor: cardBg,
        foregroundColor: textBlack,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: textBlack),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: textBlack),
            tooltip: 'Refresh',
            onPressed: _loadData,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        color: brandGreen,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildBalanceCard(),
              const SizedBox(height: 24),

              // Quick Actions Row
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Transaction History',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: textBlack,
                    ),
                  ),
                  Text(
                    '${filtered.length} activities',
                    style: const TextStyle(color: textGray, fontSize: 12),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              _buildFilterTabs(),
              const SizedBox(height: 14),

              if (_isLoading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Center(
                    child: CircularProgressIndicator(color: brandGreen),
                  ),
                )
              else if (filtered.isEmpty)
                _buildEmptyTransactions()
              else
                ...filtered.map((tx) => _buildTransactionCard(tx)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBalanceCard() {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF032213), Color(0xFF064E2A), Color(0xFF0A5C34)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: darkGreen.withValues(alpha: 0.25),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -20,
            top: -20,
            child: Icon(
              Icons.account_balance_wallet_rounded,
              size: 160,
              color: Colors.white.withValues(alpha: 0.05),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(22.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Row(
                      children: [
                        Icon(
                          Icons.shield_rounded,
                          size: 16,
                          color: Color(0xFFA7F3D0),
                        ),
                        SizedBox(width: 6),
                        Text(
                          'INFURNUS SECURE PAY',
                          style: TextStyle(
                            color: Color(0xFFA7F3D0),
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Text(
                        'Active',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                const Text(
                  'Available Wallet Balance',
                  style: TextStyle(
                    color: Color(0xFFD1FAE5),
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '₹${_walletBalance.toStringAsFixed(2)}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 36,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 22),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: brandGreen,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          elevation: 0,
                        ),
                        icon: const Icon(
                          Icons.add_circle_outline_rounded,
                          size: 18,
                        ),
                        label: const Text(
                          'Add Money',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                        onPressed: _showAddMoneyModal,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(
                            color: Color(0xFFA7F3D0),
                            width: 1.5,
                          ),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        icon: const Icon(
                          Icons.qr_code_scanner_rounded,
                          size: 18,
                        ),
                        label: const Text(
                          'Scan & Pay',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                            color: Colors.white,
                          ),
                        ),
                        onPressed: _showScanAndPayModal,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterTabs() {
    return Row(
      children: [
        _buildFilterChip('All Transactions', 'all'),
        const SizedBox(width: 8),
        _buildFilterChip('Debits', 'debit'),
        const SizedBox(width: 8),
        _buildFilterChip('Credits', 'credit'),
      ],
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _filter == value;
    return GestureDetector(
      onTap: () => setState(() => _filter = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: isSelected ? darkGreen : cardBg,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: isSelected ? darkGreen : borderCard),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
            color: isSelected ? Colors.white : textBlack,
          ),
        ),
      ),
    );
  }

  Widget _buildTransactionCard(Map<String, dynamic> tx) {
    final isCredit = tx['type'] == 'credit';
    final amount = (tx['amount'] as num?)?.toDouble() ?? 0.0;
    final title = tx['title']?.toString() ?? 'Transaction';
    final method = tx['payment_method']?.toString() ?? 'UPI';
    final status = tx['status']?.toString() ?? 'completed';
    final rawDate = tx['created_at']?.toString();
    final date = rawDate != null
        ? DateFormat('dd MMM yyyy • hh:mm a')
              .format(DateTime.tryParse(rawDate) ?? DateTime.now())
        : 'Recent';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderCard),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => _showReceiptModal(tx),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: isCredit
                        ? const Color(0xFFD1FAE5)
                        : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    isCredit
                        ? Icons.arrow_downward_rounded
                        : Icons.arrow_upward_rounded,
                    color: isCredit ? darkGreen : textGray,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: textBlack,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '$method • $date',
                        style: const TextStyle(fontSize: 11, color: textGray),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '${isCredit ? "+" : "-"}₹${amount.toStringAsFixed(2)}',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        color: isCredit ? brandGreen : textBlack,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: status == 'completed'
                            ? const Color(0xFFD1FAE5)
                            : const Color(0xFFFEF3C7),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        status.toUpperCase(),
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                          color: status == 'completed'
                              ? const Color(0xFF065F46)
                              : const Color(0xFF92400E),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyTransactions() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCard),
      ),
      child: const Column(
        children: [
          Icon(Icons.receipt_long_rounded, size: 48, color: textGray),
          SizedBox(height: 14),
          Text(
            'No Transactions Found',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: textBlack,
            ),
          ),
          SizedBox(height: 6),
          Text(
            'Your ride payments, wallet top-ups, and refunds will appear here.',
            style: TextStyle(fontSize: 12, color: textGray),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  void _showAddMoneyModal() {
    final amountController = TextEditingController(text: '500');
    int selectedPreset = 500;
    UpiPaymentApp selectedUpiApp = UpiPaymentApp.phonePe;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              decoration: const BoxDecoration(
                color: cardBg,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: const Color(0xFFCBD5E1),
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'Add Money to Wallet',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: textBlack,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Instant balance update via UPI, Cards, or Net Banking',
                      style: TextStyle(fontSize: 12, color: textGray),
                    ),
                    const SizedBox(height: 18),

                    // Amount input field
                    TextField(
                      controller: amountController,
                      keyboardType: TextInputType.number,
                      onChanged: (val) {
                        setModalState(() {
                          selectedPreset = int.tryParse(val) ?? 0;
                        });
                      },
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                        color: textBlack,
                      ),
                      decoration: InputDecoration(
                        prefixText: '₹ ',
                        prefixStyle: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                          color: textBlack,
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 14,
                        ),
                        filled: true,
                        fillColor: mainBg,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: borderCard),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: borderCard),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: brandGreen,
                            width: 2,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Preset chips
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [100, 250, 500, 1000].map((val) {
                        final isSelected = selectedPreset == val;
                        return GestureDetector(
                          onTap: () {
                            setModalState(() {
                              selectedPreset = val;
                              amountController.text = val.toString();
                            });
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 8,
                            ),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? darkGreen
                                  : const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: isSelected ? darkGreen : borderCard,
                              ),
                            ),
                            child: Text(
                              '+₹$val',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.bold,
                                color: isSelected ? Colors.white : textBlack,
                              ),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Pay Using UPI App',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: textBlack,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        _buildUpiAppChip(
                          label: 'PhonePe',
                          app: UpiPaymentApp.phonePe,
                          icon: Icons.phone_android_rounded,
                          color: const Color(0xFF5F259F),
                          selectedApp: selectedUpiApp,
                          onTap: () => setModalState(
                            () => selectedUpiApp = UpiPaymentApp.phonePe,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _buildUpiAppChip(
                          label: 'Google Pay',
                          app: UpiPaymentApp.googlePay,
                          icon: Icons.g_mobiledata_rounded,
                          color: const Color(0xFF1A73E8),
                          selectedApp: selectedUpiApp,
                          onTap: () => setModalState(
                            () => selectedUpiApp = UpiPaymentApp.googlePay,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _buildUpiAppChip(
                          label: 'Paytm',
                          app: UpiPaymentApp.paytm,
                          icon: Icons.payment_rounded,
                          color: const Color(0xFF00B9F1),
                          selectedApp: selectedUpiApp,
                          onTap: () => setModalState(
                            () => selectedUpiApp = UpiPaymentApp.paytm,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),

                    // Payment Gateway Note
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.lock_rounded, size: 16, color: darkGreen),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Powered by RBI-authorized UPI Deep Linking with 256-bit encryption.',
                              style: TextStyle(fontSize: 11, color: textGray),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),

                    InfurnusButton(
                      text: 'Proceed to Pay',
                      onPressed: () async {
                        final enteredAmount =
                            double.tryParse(amountController.text.trim()) ??
                            0.0;
                        if (enteredAmount <= 0) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Please enter a valid amount'),
                            ),
                          );
                          return;
                        }

                        Navigator.pop(ctx);
                        final topUpTxnId =
                            'topup_${DateTime.now().millisecondsSinceEpoch}';
                        final upiService = ref.read(upiPaymentServiceProvider);
                        final messenger = ScaffoldMessenger.of(context);
                        final appName = selectedUpiApp == UpiPaymentApp.phonePe
                            ? 'PhonePe'
                            : selectedUpiApp == UpiPaymentApp.googlePay
                            ? 'Google Pay'
                            : 'Paytm';

                        final result = await upiService.pay(
                          merchantVpa: 'infurnus@ybl',
                          merchantName: 'INFURNUS Wallet',
                          amount: enteredAmount,
                          transactionId: topUpTxnId,
                          app: selectedUpiApp,
                        );

                        if (result.success) {
                          setState(() {
                            _walletBalance += enteredAmount;
                            _mockCredits.insert(0, {
                              'id': topUpTxnId,
                              'amount': enteredAmount,
                              'type': 'credit',
                              'payment_method': appName,
                              'status': 'completed',
                              'title': 'Wallet Top-Up ($appName)',
                              'created_at': DateTime.now().toIso8601String(),
                            });
                          });

                          if (mounted) {
                            messenger.showSnackBar(
                              SnackBar(
                                backgroundColor: darkGreen,
                                content: Text(
                                  '₹${enteredAmount.toStringAsFixed(2)} added to INFURNUS Wallet via $appName!',
                                ),
                              ),
                            );
                          }
                        } else {
                          if (mounted) {
                            messenger.showSnackBar(
                              SnackBar(
                                backgroundColor: Colors.red.shade700,
                                content: Text(
                                  result.errorMessage ??
                                      'Payment was cancelled or failed.',
                                ),
                              ),
                            );
                          }
                        }
                      },
                      isFullWidth: true,
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showScanAndPayModal() {
    final codeController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(context).viewInsets.bottom + 20,
          ),
          decoration: const BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFCBD5E1),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Scan & Pay',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: textBlack,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Scan driver or merchant QR to pay from your wallet',
                  style: TextStyle(fontSize: 12, color: textGray),
                ),
                const SizedBox(height: 20),

                // Mock QR Scanner Viewfinder
                Container(
                  width: 200,
                  height: 200,
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: brandGreen, width: 2),
                  ),
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      const Icon(
                        Icons.qr_code_scanner_rounded,
                        size: 90,
                        color: Color(0xFFA7F3D0),
                      ),
                      Positioned(
                        bottom: 12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.6),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Text(
                            'Align QR code inside box',
                            style: TextStyle(color: Colors.white, fontSize: 10),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                const Text(
                  'Or enter UPI ID / Merchant Code manually',
                  style: TextStyle(fontSize: 12, color: textGray),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: codeController,
                  decoration: InputDecoration(
                    hintText: 'e.g. infurnus.driver@upi',
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    filled: true,
                    fillColor: mainBg,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: borderCard),
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                InfurnusButton(
                  text: 'Pay via Wallet',
                  onPressed: () {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Scanned merchant code verified. Payment ready.',
                        ),
                      ),
                    );
                  },
                  isFullWidth: true,
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showReceiptModal(Map<String, dynamic> tx) {
    final isCredit = tx['type'] == 'credit';
    final amount = (tx['amount'] as num?)?.toDouble() ?? 0.0;
    final title = tx['title']?.toString() ?? 'Transaction';
    final method = tx['payment_method']?.toString() ?? 'UPI';
    final status = tx['status']?.toString() ?? 'completed';
    final txId = tx['id']?.toString() ?? 'tx_ref';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(22),
          decoration: const BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFCBD5E1),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 18),
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: isCredit
                      ? const Color(0xFFD1FAE5)
                      : const Color(0xFFF1F5F9),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isCredit ? Icons.check_circle_rounded : Icons.receipt_rounded,
                  color: isCredit ? darkGreen : textBlack,
                  size: 28,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                '${isCredit ? "+" : "-"}₹${amount.toStringAsFixed(2)}',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w900,
                  color: isCredit ? brandGreen : textBlack,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: textGray,
                ),
              ),
              const SizedBox(height: 20),
              const Divider(color: borderCard),
              const SizedBox(height: 12),

              _buildReceiptRow('Transaction ID', txId.toUpperCase()),
              const SizedBox(height: 10),
              _buildReceiptRow('Payment Method', method),
              const SizedBox(height: 10),
              _buildReceiptRow('Status', status.toUpperCase()),
              const SizedBox(height: 24),

              InfurnusButton(
                text: 'Close Receipt',
                onPressed: () => Navigator.pop(context),
                isFullWidth: true,
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildReceiptRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: textGray, fontSize: 13)),
        Text(
          value,
          style: const TextStyle(
            color: textBlack,
            fontSize: 13,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Widget _buildUpiAppChip({
    required String label,
    required UpiPaymentApp app,
    required IconData icon,
    required Color color,
    required UpiPaymentApp selectedApp,
    required VoidCallback onTap,
  }) {
    final isSelected = selectedApp == app;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
          decoration: BoxDecoration(
            color: isSelected ? color : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected ? color : borderCard,
              width: isSelected ? 1.5 : 1,
            ),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: color.withValues(alpha: 0.25),
                      blurRadius: 4,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : [],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 20, color: isSelected ? Colors.white : color),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: isSelected ? Colors.white : textBlack,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
