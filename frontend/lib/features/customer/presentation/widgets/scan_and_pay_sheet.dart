import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/qr_parser.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../data/models/wallet_model.dart';
import '../providers/wallet_provider.dart';

class ScanAndPaySheet extends ConsumerStatefulWidget {
  final VoidCallback? onAddMoneyRequested;

  const ScanAndPaySheet({super.key, this.onAddMoneyRequested});

  @override
  ConsumerState<ScanAndPaySheet> createState() => _ScanAndPaySheetState();
}

class _ScanAndPaySheetState extends ConsumerState<ScanAndPaySheet> {
  static const Color mainBg = Color(0xFFF8FAFC);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE2E8F0);
  static const Color textBlack = Color(0xFF0F172A);
  static const Color textGray = Color(0xFF64748B);
  static const Color brandGreen = Color(0xFF10B981);
  static const Color darkGreen = Color(0xFF065F46);

  MobileScannerController? _scannerController;
  PermissionStatus _cameraPermission = PermissionStatus.denied;
  bool _isCheckingPermission = true;
  bool _torchEnabled = false;

  // Tabs: 0 = Scan, 1 = Manual Entry
  int _tabIndex = 0;
  final TextEditingController _manualInputController = TextEditingController();

  // Confirmation step state
  QrPaymentPayload? _confirmedPayload;
  RecipientDetailsModel? _recipientDetails;
  bool _isResolvingRecipient = false;
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _noteController = TextEditingController();
  bool _isSubmittingPayment = false;
  String? _paymentSuccessRef;

  @override
  void initState() {
    super.initState();
    _checkPermission();
  }

  Future<void> _checkPermission() async {
    setState(() => _isCheckingPermission = true);
    final status = await Permission.camera.status;
    setState(() {
      _cameraPermission = status;
      _isCheckingPermission = false;
    });

    if (status.isGranted) {
      _initScanner();
    }
  }

  Future<void> _requestPermission() async {
    final status = await Permission.camera.request();
    setState(() => _cameraPermission = status);
    if (status.isGranted) {
      _initScanner();
    }
  }

  void _initScanner() {
    _scannerController ??= MobileScannerController(
      detectionSpeed: DetectionSpeed.normal,
      facing: CameraFacing.back,
      torchEnabled: false,
    );
  }

  @override
  void dispose() {
    _scannerController?.dispose();
    _manualInputController.dispose();
    _amountController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_confirmedPayload != null || _isResolvingRecipient) return;
    final barcode = capture.barcodes.firstOrNull?.rawValue;
    if (barcode == null || barcode.trim().isEmpty) return;

    final parsed = QrParser.parse(barcode);
    if (!parsed.isValid) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(parsed.errorMessage ?? 'Invalid QR code scanned'),
          backgroundColor: Colors.red.shade700,
          duration: const Duration(seconds: 2),
        ),
      );
      return;
    }

    _proceedToConfirmation(parsed);
  }

  Future<void> _proceedToConfirmation(QrPaymentPayload payload) async {
    setState(() {
      _confirmedPayload = payload;
      _isResolvingRecipient = true;
    });

    final targetType = payload.type == QrPayloadType.infurnusLogisticsOrder
        ? 'order'
        : payload.type == QrPayloadType.infurnusDriver
        ? 'driver'
        : payload.type == QrPayloadType.infurnusMerchant
        ? 'merchant'
        : 'upi';

    final targetId = payload.targetId ?? payload.payeeVpa ?? '';

    final resolved = await ref
        .read(walletProvider.notifier)
        .resolveRecipient(targetType: targetType, targetId: targetId);

    if (mounted) {
      final initialAmount = payload.amount ?? resolved?.orderAmount ?? 0.0;
      if (initialAmount > 0) {
        _amountController.text = initialAmount.toStringAsFixed(2);
      } else {
        _amountController.clear();
      }

      setState(() {
        _recipientDetails = resolved;
        _isResolvingRecipient = false;
      });
    }
  }

  Future<void> _submitPayment() async {
    if (_isSubmittingPayment || _confirmedPayload == null) return;

    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid amount')),
      );
      return;
    }

    final currentBalance = ref.read(walletProvider).wallet?.balance ?? 0.0;
    if (amount > currentBalance) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Insufficient balance. Need ${CurrencyFormatter.format(amount)}, Available: ${CurrencyFormatter.format(currentBalance)}',
          ),
          backgroundColor: Colors.red.shade700,
        ),
      );
      return;
    }

    // Prompt user confirmation
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirm Payment'),
        content: Text(
          'Are you sure you want to pay ${CurrencyFormatter.format(amount)} to ${_recipientDetails?.displayName ?? _confirmedPayload?.payeeName ?? "payee"}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: brandGreen,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirm & Pay'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() => _isSubmittingPayment = true);

    final targetType =
        _confirmedPayload!.type == QrPayloadType.infurnusLogisticsOrder
        ? 'order'
        : _confirmedPayload!.type == QrPayloadType.infurnusDriver
        ? 'driver'
        : _confirmedPayload!.type == QrPayloadType.infurnusMerchant
        ? 'merchant'
        : 'upi';

    // Returns the real server transaction reference, or null on failure.
    final serverRef = await ref
        .read(walletProvider.notifier)
        .payViaWallet(
          targetType: targetType,
          targetId:
              _confirmedPayload!.targetId ?? _confirmedPayload!.payeeVpa ?? '',
          amount: amount,
          note: _noteController.text.trim().isNotEmpty
              ? _noteController.text.trim()
              : null,
        );

    if (mounted) {
      setState(() {
        _isSubmittingPayment = false;
        if (serverRef != null) {
          // Use the real server reference; never generate a local fake one.
          _paymentSuccessRef = serverRef;
        } else {
          // Show error from provider state
          final err = ref.read(walletProvider).errorMessage;
          if (err != null && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(err),
                backgroundColor: Colors.red.shade700,
              ),
            );
          }
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
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
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // Handle bar
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFCBD5E1),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 16),

            if (_paymentSuccessRef != null)
              _buildSuccessView()
            else if (_confirmedPayload != null)
              _buildConfirmationView()
            else
              _buildScanAndManualView(),
          ],
        ),
      ),
    );
  }

  Widget _buildScanAndManualView() {
    return Column(
      children: [
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
          'Scan any UPI, driver, or merchant QR code to pay',
          style: TextStyle(fontSize: 12, color: textGray),
        ),
        const SizedBox(height: 16),

        // Tabs
        Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _tabIndex = 0),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: _tabIndex == 0 ? cardBg : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: _tabIndex == 0
                          ? [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.05),
                                blurRadius: 4,
                              ),
                            ]
                          : null,
                    ),
                    child: Text(
                      'Camera Scan',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: _tabIndex == 0
                            ? FontWeight.bold
                            : FontWeight.w500,
                        color: _tabIndex == 0 ? darkGreen : textGray,
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _tabIndex = 1),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: _tabIndex == 1 ? cardBg : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: _tabIndex == 1
                          ? [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.05),
                                blurRadius: 4,
                              ),
                            ]
                          : null,
                    ),
                    child: Text(
                      'Manual Entry',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: _tabIndex == 1
                            ? FontWeight.bold
                            : FontWeight.w500,
                        color: _tabIndex == 1 ? darkGreen : textGray,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),

        if (_tabIndex == 0) _buildCameraView() else _buildManualEntryView(),
      ],
    );
  }

  Widget _buildCameraView() {
    if (_isCheckingPermission) {
      return const SizedBox(
        height: 220,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_cameraPermission.isPermanentlyDenied) {
      return Container(
        height: 220,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: mainBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: borderCard),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.videocam_off_rounded, size: 48, color: textGray),
            const SizedBox(height: 12),
            const Text(
              'Camera permission is permanently denied.',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            const Text(
              'Please enable camera access in App Settings to scan QR codes.',
              style: TextStyle(fontSize: 11, color: textGray),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: darkGreen,
                foregroundColor: Colors.white,
              ),
              icon: const Icon(Icons.settings, size: 16),
              label: const Text('Open App Settings'),
              onPressed: () => openAppSettings(),
            ),
          ],
        ),
      );
    }

    if (!_cameraPermission.isGranted) {
      return Container(
        height: 220,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: mainBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: borderCard),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.camera_alt_outlined, size: 48, color: darkGreen),
            const SizedBox(height: 12),
            const Text(
              'Camera access required',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            const Text(
              'Allow camera permission to scan UPI and driver QR codes instantly.',
              style: TextStyle(fontSize: 11, color: textGray),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: brandGreen,
                foregroundColor: Colors.white,
              ),
              onPressed: _requestPermission,
              child: const Text('Grant Camera Permission'),
            ),
          ],
        ),
      );
    }

    return Container(
      width: 250,
      height: 250,
      decoration: BoxDecoration(
        color: Colors.black,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: brandGreen, width: 2.5),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (_scannerController != null)
            MobileScanner(controller: _scannerController!, onDetect: _onDetect),
          // Viewfinder box
          Container(
            width: 170,
            height: 170,
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFA7F3D0), width: 2),
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          // Torch button
          Positioned(
            top: 10,
            right: 10,
            child: CircleAvatar(
              backgroundColor: Colors.black.withValues(alpha: 0.6),
              radius: 18,
              child: IconButton(
                padding: EdgeInsets.zero,
                icon: Icon(
                  _torchEnabled ? Icons.flash_on : Icons.flash_off,
                  size: 18,
                  color: _torchEnabled ? Colors.amber : Colors.white,
                ),
                onPressed: () {
                  _scannerController?.toggleTorch();
                  setState(() => _torchEnabled = !_torchEnabled);
                },
              ),
            ),
          ),
          Positioned(
            bottom: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.7),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                'Align QR inside square',
                style: TextStyle(color: Colors.white, fontSize: 10),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildManualEntryView() {
    final input = _manualInputController.text.trim();
    final isValid = QrParser.isValidUpiId(input) || input.length >= 4;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Enter UPI ID, Merchant Code, or Order ID',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: textBlack,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _manualInputController,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: 'e.g. driver@okhdfcbank or STORE123',
            prefixIcon: const Icon(
              Icons.alternate_email_rounded,
              color: textGray,
              size: 20,
            ),
            filled: true,
            fillColor: mainBg,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 12,
            ),
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
              borderSide: const BorderSide(color: brandGreen, width: 2),
            ),
          ),
        ),
        const SizedBox(height: 16),
        InfurnusButton(
          text: 'Verify & Proceed',
          onPressed: isValid
              ? () {
                  final parsed = QrParser.parse(input);
                  _proceedToConfirmation(parsed);
                }
              : null,
          isFullWidth: true,
        ),
      ],
    );
  }

  Widget _buildConfirmationView() {
    if (_isResolvingRecipient) {
      return const Padding(
        padding: EdgeInsets.all(30),
        child: Column(
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text(
              'Verifying payee details from server...',
              style: TextStyle(fontSize: 13, color: textGray),
            ),
          ],
        ),
      );
    }

    final wallet = ref.watch(walletProvider).wallet;
    final balance = wallet?.balance ?? 0.0;
    final payeeName =
        _recipientDetails?.displayName ??
        _confirmedPayload?.payeeName ??
        'Payee';
    final targetId =
        _confirmedPayload?.targetId ?? _confirmedPayload?.payeeVpa ?? '';
    final isFixed = _confirmedPayload?.isAmountFixed == true;
    final enteredAmount = double.tryParse(_amountController.text.trim()) ?? 0.0;
    final isInsufficient = enteredAmount > balance;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Confirm Payment',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: textBlack,
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close_rounded, size: 20),
              onPressed: () => setState(() => _confirmedPayload = null),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // Payee Card
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFF0FDF4),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFA7F3D0)),
          ),
          child: Row(
            children: [
              const CircleAvatar(
                backgroundColor: darkGreen,
                radius: 22,
                child: Icon(
                  Icons.verified_user_rounded,
                  color: Colors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      payeeName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: textBlack,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      targetId,
                      style: const TextStyle(fontSize: 12, color: textGray),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),

        // Amount Field
        const Text(
          'Payment Amount',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: textBlack,
          ),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: _amountController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          readOnly: isFixed,
          onChanged: (_) => setState(() {}),
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w900,
            color: textBlack,
          ),
          decoration: InputDecoration(
            prefixText: '₹ ',
            prefixStyle: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w900,
              color: textBlack,
            ),
            suffixIcon: isFixed
                ? const Tooltip(
                    message: 'Amount is bound to order and cannot be edited',
                    child: Icon(Icons.lock_outline, color: textGray, size: 18),
                  )
                : null,
            filled: true,
            fillColor: isFixed ? const Color(0xFFF1F5F9) : mainBg,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 12,
            ),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 12),

        // Note field
        TextField(
          controller: _noteController,
          decoration: InputDecoration(
            hintText: 'Add an optional note (e.g. Delivery tip)',
            filled: true,
            fillColor: mainBg,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 10,
            ),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
        const SizedBox(height: 16),

        // Wallet Balance Info Box
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: isInsufficient
                ? const Color(0xFFFEF2F2)
                : const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isInsufficient ? const Color(0xFFFCA5A5) : borderCard,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(
                    isInsufficient
                        ? Icons.error_outline
                        : Icons.account_balance_wallet_rounded,
                    size: 16,
                    color: isInsufficient ? Colors.red : textGray,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Wallet Balance: ${CurrencyFormatter.format(balance)}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: isInsufficient ? Colors.red : textBlack,
                    ),
                  ),
                ],
              ),
              if (isInsufficient)
                GestureDetector(
                  onTap: () {
                    Navigator.pop(context);
                    widget.onAddMoneyRequested?.call();
                  },
                  child: const Text(
                    '+ Add Money',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: brandGreen,
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        InfurnusButton(
          text: _isSubmittingPayment ? 'Processing...' : 'Pay via Wallet',
          isLoading: _isSubmittingPayment,
          onPressed:
              (enteredAmount > 0 && !isInsufficient && !_isSubmittingPayment)
              ? _submitPayment
              : null,
          isFullWidth: true,
        ),
      ],
    );
  }

  Widget _buildSuccessView() {
    return Column(
      children: [
        const Icon(Icons.check_circle_rounded, color: brandGreen, size: 64),
        const SizedBox(height: 14),
        const Text(
          'Payment Successful!',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: textBlack,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Paid ${CurrencyFormatter.format(double.tryParse(_amountController.text) ?? 0.0)} to ${_recipientDetails?.displayName ?? _confirmedPayload?.payeeName ?? "Payee"}',
          style: const TextStyle(fontSize: 13, color: textGray),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            'Ref: $_paymentSuccessRef',
            style: const TextStyle(
              fontSize: 11,
              fontFamily: 'monospace',
              color: textGray,
            ),
          ),
        ),
        const SizedBox(height: 24),
        InfurnusButton(
          text: 'Done',
          onPressed: () => Navigator.pop(context),
          isFullWidth: true,
        ),
      ],
    );
  }
}
