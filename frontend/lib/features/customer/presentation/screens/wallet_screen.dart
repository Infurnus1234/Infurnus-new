import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/services/payment_gateway.dart';
import '../../../../core/services/upi_payment_service.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../data/models/wallet_model.dart';
import '../providers/wallet_provider.dart';
import '../widgets/scan_and_pay_sheet.dart';

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

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(walletProvider.notifier).loadData();
    });
  }

  Future<void> _refresh() async {
    await ref.read(walletProvider.notifier).loadData();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(walletProvider);

    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        title: const Text(
          'INFURNUS Wallet & Pay',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: textBlack,
          ),
        ),
        centerTitle: true,
        backgroundColor: cardBg,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18, color: textBlack),
          onPressed: () => Navigator.maybePop(context),
        ),
        actions: [
          IconButton(
            icon: state.isLoading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh_rounded, size: 20, color: textBlack),
            tooltip: 'Refresh Wallet',
            onPressed: state.isLoading ? null : _refresh,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: _buildBody(state),
      ),
    );
  }

  Widget _buildBody(WalletState state) {
    // 1. Initial Loading State
    if (state.isLoading && state.wallet == null) {
      return const InfurnusLoader(message: 'Loading your wallet...');
    }

    // 2. Offline State
    if (state.isOffline && state.wallet == null) {
      return InfurnusErrorView(
        message: 'You are currently offline. Please check your internet connection.',
        onRetry: _refresh,
      );
    }

    // 3. Error State
    if (state.errorMessage != null && state.wallet == null) {
      return InfurnusErrorView(
        message: state.errorMessage!,
        onRetry: _refresh,
      );
    }

    final wallet = state.wallet ?? WalletModel.empty();
    final transactions = state.transactions;
    final totalCount = state.totalCount > 0 ? state.totalCount : wallet.activityCount;

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Available Balance Card
          _buildBalanceCard(wallet),
          const SizedBox(height: 20),

          // Activity Header with Real Count
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Activity & Transactions',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: textBlack,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$totalCount activities',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: textGray,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Real Filter Tabs
          _buildFilterTabs(state.filter),
          const SizedBox(height: 14),

          // Transaction List or States
          if (state.isHistoryLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (transactions.isEmpty)
            _buildEmptyTransactions()
          else
            ...transactions.map((tx) => _buildTransactionCard(tx)),
        ],
      ),
    );
  }

  Widget _buildBalanceCard(WalletModel wallet) {
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
            padding: const EdgeInsets.all(20.0),
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
                        color: wallet.isActive
                            ? Colors.white.withValues(alpha: 0.15)
                            : Colors.orange.withValues(alpha: 0.25),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        wallet.isActive ? 'Active' : 'Unactivated',
                        style: const TextStyle(
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
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    CurrencyFormatter.format(wallet.balance),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 34,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.5,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
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

  Widget _buildFilterTabs(String currentFilter) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildFilterChip('All Transactions', 'all', currentFilter),
          const SizedBox(width: 8),
          _buildFilterChip('Debits', 'debit', currentFilter),
          const SizedBox(width: 8),
          _buildFilterChip('Credits', 'credit', currentFilter),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value, String currentFilter) {
    final isSelected = currentFilter == value;
    return GestureDetector(
      onTap: () => ref.read(walletProvider.notifier).setFilter(value),
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

  Widget _buildTransactionCard(WalletTransactionModel tx) {
    final isCredit = tx.type == 'credit';
    final amountStr = CurrencyFormatter.format(tx.amount);
    final dateStr = DateFormat('dd MMM yyyy • hh:mm a').format(tx.createdAt);

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
                    color: isCredit ? darkGreen : const Color(0xFFE11D48),
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tx.description,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: textBlack,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${tx.paymentMethod} • $dateStr',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11, color: textGray),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '${isCredit ? "+" : "-"}$amountStr',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                        color: isCredit ? brandGreen : textBlack,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _buildStatusBadge(tx.status),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStatusBadge(String status) {
    Color bg;
    Color fg;

    switch (status.toUpperCase()) {
      case 'COMPLETED':
      case 'CAPTURED':
        bg = const Color(0xFFD1FAE5);
        fg = darkGreen;
        break;
      case 'PENDING':
        bg = const Color(0xFFFEF3C7);
        fg = const Color(0xFF92400E);
        break;
      case 'FAILED':
        bg = const Color(0xFFFEE2E2);
        fg = const Color(0xFF991B1B);
        break;
      case 'REFUNDED':
        bg = const Color(0xFFE0E7FF);
        fg = const Color(0xFF3730A3);
        break;
      default:
        bg = const Color(0xFFF1F5F9);
        fg = textGray;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.bold,
          color: fg,
        ),
      ),
    );
  }

  Widget _buildEmptyTransactions() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCard),
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.receipt_long_outlined,
            size: 48,
            color: textGray,
          ),
          SizedBox(height: 12),
          Text(
            'No transactions yet',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: textBlack,
            ),
          ),
          SizedBox(height: 4),
          Text(
            'Your wallet deposits and scan-and-pay activities will appear here.',
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
            final isProcessing = ref.watch(walletProvider).isTopUpProcessing;

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
                    const SizedBox(height: 4),
                    const Text(
                      'Instant balance update via UPI, Cards, or Net Banking',
                      style: TextStyle(fontSize: 12, color: textGray),
                    ),
                    const SizedBox(height: 18),

                    // Amount input field
                    TextField(
                      controller: amountController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
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
                      'Select Payment Method',
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
                    const SizedBox(height: 20),

                    InfurnusButton(
                      text: isProcessing ? 'Processing Checkout...' : 'Proceed to Pay',
                      isLoading: isProcessing,
                      onPressed: isProcessing
                          ? null
                          : () async {
                              final amt = double.tryParse(amountController.text.trim()) ?? 0.0;
                              if (amt < 10) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Minimum top-up is ₹10.00')),
                                );
                                return;
                              }

                              final gateway = ref.read(upiPaymentGatewayProvider);
                              final success = await ref.read(walletProvider.notifier).topUp(
                                    amount: amt,
                                    gateway: gateway,
                                    paymentMethod: selectedUpiApp.name.toUpperCase(),
                                    extraData: {'app': selectedUpiApp},
                                  );

                              if (ctx.mounted) {
                                Navigator.pop(ctx);
                              }

                              if (mounted) {
                                if (success) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(
                                        'Top-up of ${CurrencyFormatter.format(amt)} successful! Wallet updated.',
                                      ),
                                      backgroundColor: darkGreen,
                                    ),
                                  );
                                } else {
                                  final err = ref.read(walletProvider).errorMessage;
                                  if (err != null) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(err),
                                        backgroundColor: Colors.red.shade700,
                                      ),
                                    );
                                  }
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
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? color.withValues(alpha: 0.12) : cardBg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected ? color : borderCard,
              width: isSelected ? 1.5 : 1.0,
            ),
          ),
          child: Column(
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                  color: isSelected ? color : textBlack,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showScanAndPayModal() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return ScanAndPaySheet(
          onAddMoneyRequested: _showAddMoneyModal,
        );
      },
    );
  }

  void _showReceiptModal(WalletTransactionModel tx) {
    final isCredit = tx.type == 'credit';
    final amountStr = CurrencyFormatter.format(tx.amount);
    final dateStr = DateFormat('dd MMM yyyy • hh:mm a').format(tx.createdAt);

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
                '${isCredit ? "+" : "-"}$amountStr',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w900,
                  color: isCredit ? brandGreen : textBlack,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                tx.description,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: textGray,
                ),
              ),
              const SizedBox(height: 20),
              const Divider(color: borderCard),
              const SizedBox(height: 12),

              _buildReceiptRow('Transaction ID', tx.id.toUpperCase()),
              const SizedBox(height: 10),
              _buildReceiptRow('Reference', tx.reference),
              const SizedBox(height: 10),
              _buildReceiptRow('Payment Method', tx.paymentMethod),
              const SizedBox(height: 10),
              _buildReceiptRow('Status', tx.status),
              const SizedBox(height: 10),
              _buildReceiptRow('Date & Time', dateStr),
              const SizedBox(height: 10),
              _buildReceiptRow('Balance After', CurrencyFormatter.format(tx.balanceAfter)),
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
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: textGray),
        ),
        Flexible(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.bold,
              color: textBlack,
            ),
          ),
        ),
      ],
    );
  }
}
