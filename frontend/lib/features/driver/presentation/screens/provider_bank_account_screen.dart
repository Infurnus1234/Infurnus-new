import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../../data/models/provider_bank_account_model.dart';
import '../providers/driver_providers.dart';

final providerBankAccountFutureProvider =
    FutureProvider.autoDispose<ProviderBankAccountModel?>((ref) async {
  final dataSource = ref.watch(driverRemoteDataSourceProvider);
  return dataSource.getProviderBankAccount();
});

class ProviderBankAccountScreen extends ConsumerStatefulWidget {
  const ProviderBankAccountScreen({super.key});

  @override
  ConsumerState<ProviderBankAccountScreen> createState() => _ProviderBankAccountScreenState();
}

class _ProviderBankAccountScreenState extends ConsumerState<ProviderBankAccountScreen> {
  final _holderNameController = TextEditingController();
  final _accountNumberController = TextEditingController();
  final _ifscController = TextEditingController();
  final _bankNameController = TextEditingController();
  final _upiController = TextEditingController();

  bool _isEditing = false;
  bool _isSaving = false;

  @override
  void dispose() {
    _holderNameController.dispose();
    _accountNumberController.dispose();
    _ifscController.dispose();
    _bankNameController.dispose();
    _upiController.dispose();
    super.dispose();
  }

  void _populateFields(ProviderBankAccountModel bank) {
    if (_holderNameController.text.isEmpty) {
      _holderNameController.text = bank.accountHolderName;
      _ifscController.text = bank.ifscCode;
      _bankNameController.text = bank.bankName;
      _upiController.text = bank.upiId ?? '';
    }
  }

  Future<void> _saveBankAccount() async {
    if (_holderNameController.text.trim().isEmpty ||
        _accountNumberController.text.trim().isEmpty ||
        _ifscController.text.trim().isEmpty ||
        _bankNameController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill all required bank account fields')),
      );
      return;
    }

    setState(() => _isSaving = true);
    try {
      final dataSource = ref.read(driverRemoteDataSourceProvider);
      await dataSource.upsertProviderBankAccount({
        'accountHolderName': _holderNameController.text.trim(),
        'accountNumber': _accountNumberController.text.trim(),
        'ifscCode': _ifscController.text.trim().toUpperCase(),
        'bankName': _bankNameController.text.trim(),
        if (_upiController.text.trim().isNotEmpty) 'upiId': _upiController.text.trim(),
      });

      ref.invalidate(providerBankAccountFutureProvider);
      if (mounted) {
        setState(() {
          _isSaving = false;
          _isEditing = false;
          _accountNumberController.clear();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Bank account details updated successfully'),
            backgroundColor: AppColors.primaryGreen,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSaving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save bank account: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bankAsync = ref.watch(providerBankAccountFutureProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bank & Payout Details'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(providerBankAccountFutureProvider),
          ),
        ],
      ),
      body: bankAsync.when(
        loading: () => const InfurnusLoader(message: 'Loading bank details...'),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (bank) {
          if (bank != null && !_isEditing) {
            _populateFields(bank);
            return _buildBankDisplay(context, bank);
          }
          return _buildBankForm(context, isNew: bank == null);
        },
      ),
    );
  }

  Widget _buildBankDisplay(BuildContext context, ProviderBankAccountModel bank) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1B2E24), Color(0xFF0F1E16)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.primaryGreen.withOpacity(0.35)),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryGreen.withOpacity(0.15),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      bank.bankName.toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.1,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: bank.isVerified
                            ? AppColors.primaryGreen.withOpacity(0.2)
                            : Colors.amber.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: bank.isVerified ? AppColors.primaryGreen : Colors.amber,
                        ),
                      ),
                      child: Text(
                        bank.isVerified ? 'VERIFIED' : 'PENDING',
                        style: TextStyle(
                          color: bank.isVerified ? AppColors.primaryGreen : Colors.amber,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 28),
                Text(
                  bank.accountNumberMasked,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    letterSpacing: 3,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('ACCOUNT HOLDER', style: TextStyle(color: Colors.white54, fontSize: 10)),
                        const SizedBox(height: 3),
                        Text(
                          bank.accountHolderName,
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        const Text('IFSC CODE', style: TextStyle(color: Colors.white54, fontSize: 10)),
                        const SizedBox(height: 3),
                        Text(
                          bank.ifscCode,
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ],
                ),
                if (bank.upiId != null && bank.upiId!.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      const Icon(Icons.flash_on, color: AppColors.primaryGreen, size: 14),
                      const SizedBox(width: 4),
                      Text('UPI: ${bank.upiId}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),
          InfurnusCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.shield_outlined, color: AppColors.primaryGreen, size: 20),
                    SizedBox(width: 8),
                    Text('Payout Security', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Your full bank account number is securely encrypted. All weekly payouts and settlements are automatically deposited into this verified account.',
                  style: TextStyle(color: Colors.grey[400], fontSize: 13, height: 1.4),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton(
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primaryGreen,
              side: const BorderSide(color: AppColors.primaryGreen),
              padding: const EdgeInsets.symmetric(vertical: 16),
              minimumSize: const Size(double.infinity, 50),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: () => setState(() => _isEditing = true),
            child: const Text('Update Bank Details', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
        ],
      ),
    );
  }

  Widget _buildBankForm(BuildContext context, {required bool isNew}) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isNew ? 'Add Bank Account' : 'Update Bank Account',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Enter your bank account details for direct platform settlements and payouts.',
            style: TextStyle(color: Colors.grey[400], fontSize: 13),
          ),
          const SizedBox(height: 20),
          InfurnusTextField(
            label: 'Account Holder Name',
            controller: _holderNameController,
            hintText: 'As listed in bank passbook',
          ),
          const SizedBox(height: 14),
          InfurnusTextField(
            label: 'Account Number',
            controller: _accountNumberController,
            hintText: 'Enter full account number',
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 14),
          InfurnusTextField(
            label: 'IFSC Code',
            controller: _ifscController,
            hintText: 'e.g. SBIN0001234',
          ),
          const SizedBox(height: 14),
          InfurnusTextField(
            label: 'Bank Name',
            controller: _bankNameController,
            hintText: 'e.g. State Bank of India',
          ),
          const SizedBox(height: 14),
          InfurnusTextField(
            label: 'UPI ID (Optional)',
            controller: _upiController,
            hintText: 'e.g. name@okhdfcbank',
          ),
          const SizedBox(height: 26),
          InfurnusButton(
            text: _isSaving ? 'Saving Details...' : 'Save Bank Details',
            isLoading: _isSaving,
            onPressed: _isSaving ? null : _saveBankAccount,
          ),
          if (!isNew) ...[
            const SizedBox(height: 12),
            TextButton(
              style: TextButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
              ),
              onPressed: () => setState(() => _isEditing = false),
              child: const Text('Cancel', style: TextStyle(color: Colors.white70)),
            ),
          ],
        ],
      ),
    );
  }
}
