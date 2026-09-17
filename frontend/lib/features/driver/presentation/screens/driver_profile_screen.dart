import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../providers/driver_dashboard_provider.dart';
import '../providers/driver_providers.dart';

class DriverProfileScreen extends ConsumerStatefulWidget {
  const DriverProfileScreen({super.key});

  @override
  ConsumerState<DriverProfileScreen> createState() => _DriverProfileScreenState();
}

class _DriverProfileScreenState extends ConsumerState<DriverProfileScreen> {
  final _businessNameController = TextEditingController();
  final _businessDescController = TextEditingController();
  bool _isEditing = false;
  bool _isSaving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initFields();
    });
  }

  void _initFields() {
    final partner = ref.read(driverDashboardProvider).partner;
    if (partner != null) {
      _businessNameController.text = partner.businessName;
      _businessDescController.text = partner.businessDescription ?? '';
    }
  }

  @override
  void dispose() {
    _businessNameController.dispose();
    _businessDescController.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    final partner = ref.read(driverDashboardProvider).partner;
    if (partner == null) return;

    if (_businessNameController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Business name cannot be empty')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
      _errorMessage = null;
    });

    try {
      final updateData = {
        'businessName': _businessNameController.text.trim(),
        'businessDescription': _businessDescController.text.trim(),
      };

      await ref.read(updatePartnerUseCaseProvider).execute(partner.id, updateData);
      await ref.read(driverDashboardProvider.notifier).loadDashboard();

      if (mounted) {
        setState(() {
          _isSaving = false;
          _isEditing = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated successfully!')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSaving = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final dashboardState = ref.watch(driverDashboardProvider);
    final partner = dashboardState.partner;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner Profile'),
        actions: [
          if (partner != null && !_isEditing)
            IconButton(
              icon: const Icon(Icons.edit),
              onPressed: () => setState(() => _isEditing = true),
            ),
        ],
      ),
      body: dashboardState.isLoading
          ? const InfurnusLoader(message: 'Loading Partner Profile...')
          : partner == null
              ? const Center(child: Text('No Partner Profile found.'))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_errorMessage != null) _buildErrorBanner(_errorMessage!),

                      // Status Header
                      _buildStatusHeader(partner),
                      const SizedBox(height: 20),

                      // Business Info
                      InfurnusCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Business Information', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 16),
                            InfurnusTextField(
                              label: 'Business Name',
                              controller: _businessNameController,
                            ),
                            const SizedBox(height: 12),
                            InfurnusTextField(
                              label: 'Business Description',
                              controller: _businessDescController,
                            ),
                            if (_isEditing) ...[
                              const SizedBox(height: 20),
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: _isSaving ? null : () => setState(() => _isEditing = false),
                                      child: const Text('Cancel'),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: InfurnusButton(
                                      text: 'Save Changes',
                                      isLoading: _isSaving,
                                      onPressed: _saveProfile,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildErrorBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.red[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red[200]!),
      ),
      child: Text(message, style: const TextStyle(color: Colors.red, fontSize: 13)),
    );
  }

  Widget _buildStatusHeader(dynamic partner) {
    final status = partner.approvalStatus;
    Color color = Colors.orange;
    if (status == 'approved') color = AppColors.primaryGreen;
    if (status == 'rejected') color = Colors.red;

    return InfurnusCard(
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Approval Status', style: TextStyle(color: Colors.grey, fontSize: 12)),
              Text(status.toUpperCase(), style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text('Availability', style: TextStyle(color: Colors.grey, fontSize: 12)),
              Text(partner.availabilityStatus.toUpperCase(), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
        ],
      ),
    );
  }
}
