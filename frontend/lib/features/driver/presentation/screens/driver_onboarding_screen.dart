import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../providers/driver_dashboard_provider.dart';
import '../providers/driver_onboarding_provider.dart';

class DriverOnboardingScreen extends ConsumerStatefulWidget {
  const DriverOnboardingScreen({super.key});

  @override
  ConsumerState<DriverOnboardingScreen> createState() => _DriverOnboardingScreenState();
}

class _DriverOnboardingScreenState extends ConsumerState<DriverOnboardingScreen> {
  final _businessNameController = TextEditingController();
  final _businessDescController = TextEditingController();

  // Vehicle Controllers
  final _driverProfileIdController = TextEditingController();
  final _makeController = TextEditingController();
  final _modelController = TextEditingController();
  final _colorController = TextEditingController();
  final _plateNumberController = TextEditingController();

  String _selectedDocType = 'DRIVING_LICENCE';
  final _issuedAtController = TextEditingController();
  final _expiresAtController = TextEditingController();

  final List<String> _docTypes = [
    'DRIVING_LICENCE',
    'AADHAAR',
    'PAN',
    'PROFILE_PHOTO',
    'ADDRESS_PROOF',
    'VEHICLE_RC',
    'VEHICLE_INSURANCE',
    'VEHICLE_PERMIT',
    'VEHICLE_FITNESS',
    'OTHER',
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(driverOnboardingProvider.notifier).loadOnboardingData();
    });
  }

  @override
  void dispose() {
    _businessNameController.dispose();
    _businessDescController.dispose();
    _driverProfileIdController.dispose();
    _makeController.dispose();
    _modelController.dispose();
    _colorController.dispose();
    _plateNumberController.dispose();
    _issuedAtController.dispose();
    _expiresAtController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final onboardingState = ref.watch(driverOnboardingProvider);
    final partner = onboardingState.partner;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner Onboarding'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            ref.read(driverDashboardProvider.notifier).loadDashboard();
            context.pop();
          },
        ),
      ),
      body: onboardingState.isLoading
          ? const InfurnusLoader(message: 'Loading Onboarding Data...')
          : onboardingState.errorMessage != null && partner == null
              ? InfurnusErrorView(
                  message: onboardingState.errorMessage!,
                  onRetry: () => ref.read(driverOnboardingProvider.notifier).loadOnboardingData(),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (onboardingState.errorMessage != null)
                        _buildErrorBanner(onboardingState.errorMessage!),
                      if (onboardingState.successMessage != null)
                        _buildSuccessBanner(onboardingState.successMessage!),

                      // Stage 1: Partner Application or Status
                      if (partner == null)
                        _buildPartnerApplicationForm(onboardingState)
                      else ...[
                        _buildPartnerStatusCard(partner),
                        const SizedBox(height: 20),

                        // Stage 3: KYC Documents Metadata Form & List
                        _buildKycSection(onboardingState),
                        const SizedBox(height: 20),

                        // Stage 4: Vehicle Setup
                        _buildVehicleSection(onboardingState),
                      ],
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

  Widget _buildSuccessBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.green[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.green[200]!),
      ),
      child: Text(message, style: const TextStyle(color: AppColors.primaryGreen, fontSize: 13)),
    );
  }

  // --- Stage 1: Partner Application Form ---
  Widget _buildPartnerApplicationForm(DriverOnboardingState state) {
    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Step 1: Apply as Partner', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Fill in your business details to apply for driver partnership.', style: TextStyle(color: Colors.grey, fontSize: 13)),
          const SizedBox(height: 16),
          InfurnusTextField(
            label: 'Business Name',
            hintText: 'e.g. John Rides',
            controller: _businessNameController,
          ),
          const SizedBox(height: 12),
          InfurnusTextField(
            label: 'Business Description (Optional)',
            hintText: 'Describe your service',
            controller: _businessDescController,
          ),
          const SizedBox(height: 20),
          InfurnusButton(
            text: 'Submit Application',
            isLoading: state.isSubmitting,
            onPressed: () async {
              if (_businessNameController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Please enter a business name')),
                );
                return;
              }
              final success = await ref.read(driverOnboardingProvider.notifier).createPartnerProfile(
                    businessName: _businessNameController.text,
                    businessDescription: _businessDescController.text,
                  );
              if (success) {
                ref.read(driverDashboardProvider.notifier).loadDashboard();
              }
            },
          ),
        ],
      ),
    );
  }

  // --- Stage 2: Partner Status Display ---
  Widget _buildPartnerStatusCard(dynamic partner) {
    final String status = partner.approvalStatus;
    Color statusColor = Colors.orange;

    if (status == 'approved') {
      statusColor = AppColors.primaryGreen;
    } else if (status == 'rejected') {
      statusColor = Colors.red;
    } else if (status == 'pending' || status == 'under_review') {
      statusColor = Colors.amber;
    }

    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(partner.businessName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  status.toUpperCase(),
                  style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Partner ID: ${partner.id}',
            style: TextStyle(color: Colors.grey[600], fontSize: 12),
          ),
        ],
      ),
    );
  }

  // --- Stage 3: KYC Document Metadata Upload ---
  Widget _buildKycSection(DriverOnboardingState state) {
    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Step 2: KYC Document Metadata', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          const Text('Submit document verification details required by the backend.', style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 16),

          DropdownButtonFormField<String>(
            value: _selectedDocType,
            decoration: const InputDecoration(
              labelText: 'Document Type',
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
            items: _docTypes.map((type) {
              return DropdownMenuItem(value: type, child: Text(type));
            }).toList(),
            onChanged: (val) {
              if (val != null) setState(() => _selectedDocType = val);
            },
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: InfurnusTextField(
                  label: 'Issued At (YYYY-MM-DD)',
                  hintText: '2023-01-01',
                  controller: _issuedAtController,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InfurnusTextField(
                  label: 'Expires At (YYYY-MM-DD)',
                  hintText: '2028-01-01',
                  controller: _expiresAtController,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          InfurnusButton(
            text: 'Add Document Metadata',
            isLoading: state.isSubmitting,
            onPressed: () {
              ref.read(driverOnboardingProvider.notifier).addDocumentMetadata(
                    documentType: _selectedDocType,
                    issuedAt: _issuedAtController.text.trim(),
                    expiresAt: _expiresAtController.text.trim(),
                  );
            },
          ),

          if (state.documents.isNotEmpty) ...[
            const SizedBox(height: 20),
            const Text('Submitted Documents:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 8),
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: state.documents.length,
              itemBuilder: (context, index) {
                final doc = state.documents[index];
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.file_present, color: AppColors.primaryGreen),
                  title: Text(doc.type, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  subtitle: Text('Status: ${doc.status}'),
                );
              },
            ),
          ],
        ],
      ),
    );
  }

  // --- Stage 4: Vehicle Setup ---
  Widget _buildVehicleSection(DriverOnboardingState state) {
    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Step 3: Register Vehicle', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          const Text('Enter vehicle details matching your driver profile.', style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 16),
          InfurnusTextField(
            label: 'Driver Profile UUID',
            hintText: 'Enter driverProfileId from backend',
            controller: _driverProfileIdController,
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: InfurnusTextField(
                  label: 'Make',
                  hintText: 'Toyota',
                  controller: _makeController,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InfurnusTextField(
                  label: 'Model',
                  hintText: 'Camry',
                  controller: _modelController,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: InfurnusTextField(
                  label: 'Color (Optional)',
                  hintText: 'White',
                  controller: _colorController,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InfurnusTextField(
                  label: 'Plate Number',
                  hintText: 'KA-01-AB-1234',
                  controller: _plateNumberController,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          InfurnusButton(
            text: 'Register Vehicle',
            isLoading: state.isSubmitting,
            onPressed: () async {
              if (_driverProfileIdController.text.trim().isEmpty ||
                  _makeController.text.trim().isEmpty ||
                  _modelController.text.trim().isEmpty ||
                  _plateNumberController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Please fill all required vehicle fields')),
                );
                return;
              }

              final success = await ref.read(driverOnboardingProvider.notifier).registerVehicle(
                    driverProfileId: _driverProfileIdController.text.trim(),
                    make: _makeController.text.trim(),
                    model: _modelController.text.trim(),
                    color: _colorController.text.trim(),
                    plateNumber: _plateNumberController.text.trim(),
                  );

              if (success) {
                ref.read(driverDashboardProvider.notifier).loadDashboard();
              }
            },
          ),
        ],
      ),
    );
  }
}
