import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
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
  // Partner Controllers
  final _businessNameController = TextEditingController();
  final _businessDescController = TextEditingController();

  // Driver Profile Controllers
  final _licenseNumberController = TextEditingController();
  final _licenseExpiryController = TextEditingController();

  // Vehicle Controllers
  final _makeController = TextEditingController();
  final _modelController = TextEditingController();
  final _colorController = TextEditingController();
  final _plateNumberController = TextEditingController();

  String _selectedSector = 'passenger';
  final List<Map<String, String>> _sectors = [
    {'id': 'passenger', 'label': 'Passenger Rides'},
    {'id': 'logistics', 'label': 'Logistics & Cargo'},
    {'id': 'service', 'label': 'Service Vehicle'},
    {'id': 'premium', 'label': 'Premium Luxury'},
  ];

  // Document Metadata Controllers
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
    _licenseNumberController.dispose();
    _licenseExpiryController.dispose();
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
    final driverProfile = onboardingState.driverProfile;

    // Prefill license fields if profile already exists
    if (driverProfile != null && _licenseNumberController.text.isEmpty) {
      _licenseNumberController.text = driverProfile.licenseNumber;
      _licenseExpiryController.text = driverProfile.licenseExpiry.split('T').first;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Driver & Partner Onboarding'),
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
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (onboardingState.errorMessage != null)
                    _buildErrorBanner(onboardingState.errorMessage!),
                  if (onboardingState.successMessage != null)
                    _buildSuccessBanner(onboardingState.successMessage!),

                  // STEP 1: Partner Application (if not registered yet)
                  if (partner == null)
                    _buildPartnerApplicationForm(onboardingState)
                  else ...[
                    _buildPartnerStatusCard(partner),
                    const SizedBox(height: 20),

                    // STEP 2: Driver Profile & License
                    _buildDriverProfileSection(onboardingState),
                    const SizedBox(height: 20),

                    // STEP 3: KYC Documents Metadata Form & List
                    _buildKycSection(onboardingState),
                    const SizedBox(height: 20),

                    // STEP 4: Vehicle Registration (Auto-links Driver Profile)
                    _buildVehicleSection(onboardingState),
                    const SizedBox(height: 24),

                    // STEP 5: Verification & Dashboard Access
                    _buildDashboardAccessButton(),
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

  // --- Step 1: Partner Application Form ---
  Widget _buildPartnerApplicationForm(DriverOnboardingState state) {
    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Step 1: Apply as Partner',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Fill in your details to register as an INFURNUS partner.',
              style: TextStyle(color: Colors.grey, fontSize: 13)),
          const SizedBox(height: 16),
          InfurnusTextField(
            label: 'Partner / Business Name',
            hintText: 'e.g. John Doe Services',
            controller: _businessNameController,
          ),
          const SizedBox(height: 12),
          InfurnusTextField(
            label: 'Description / Bio (Optional)',
            hintText: 'Professional driver with 5+ years experience',
            controller: _businessDescController,
          ),
          const SizedBox(height: 20),
          InfurnusButton(
            text: 'Submit Partner Application',
            isLoading: state.isSubmitting,
            onPressed: () async {
              if (_businessNameController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Please enter a business or partner name')),
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

  // --- Step 1 Display: Partner Status Card ---
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
              Expanded(
                child: Text(
                  partner.businessName,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: statusColor.withOpacity(0.3)),
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
          if (partner.approvalStatus == 'approved') ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.check_circle, color: AppColors.primaryGreen, size: 16),
                const SizedBox(width: 6),
                Text(
                  'Partner Account Approved',
                  style: TextStyle(color: AppColors.primaryGreen, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // --- Step 2: Driver Profile & License Details ---
  Widget _buildDriverProfileSection(DriverOnboardingState state) {
    final profile = state.driverProfile;
    final isVerified = profile?.verificationStatus == 'verified';

    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Step 2: Driver Profile & License',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              if (profile != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: (isVerified ? AppColors.primaryGreen : Colors.amber).withOpacity(0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    profile.verificationStatus.toUpperCase(),
                    style: TextStyle(
                      color: isVerified ? AppColors.primaryGreen : Colors.amber[800],
                      fontWeight: FontWeight.bold,
                      fontSize: 11,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Your driving license is required for verification and ride allocations.',
            style: TextStyle(color: Colors.grey, fontSize: 12),
          ),
          const SizedBox(height: 16),
          InfurnusTextField(
            label: 'Driving License Number',
            hintText: 'DL-1420110012345',
            controller: _licenseNumberController,
          ),
          const SizedBox(height: 12),
          InfurnusTextField(
            label: 'License Expiry (YYYY-MM-DD)',
            hintText: '2029-12-31',
            controller: _licenseExpiryController,
          ),
          const SizedBox(height: 16),
          InfurnusButton(
            text: profile != null ? 'Update Driver Profile' : 'Save Driver Profile',
            isLoading: state.isSubmitting,
            onPressed: () async {
              if (_licenseNumberController.text.trim().isEmpty ||
                  _licenseExpiryController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Please enter license number and expiry date')),
                );
                return;
              }
              await ref.read(driverOnboardingProvider.notifier).upsertDriverProfile(
                    licenseNumber: _licenseNumberController.text.trim(),
                    licenseExpiry: _licenseExpiryController.text.trim(),
                  );
            },
          ),
        ],
      ),
    );
  }

  // --- Step 3: KYC Document Metadata Upload ---
  Widget _buildKycSection(DriverOnboardingState state) {
    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Step 3: KYC Verification Documents',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          const Text('Submit document verification records required by INFURNUS.',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 16),

          DropdownButtonFormField<String>(
            value: _selectedDocType,
            decoration: const InputDecoration(
              labelText: 'Document Type',
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
            items: _docTypes.map((type) {
              return DropdownMenuItem(value: type, child: Text(type.replaceAll('_', ' ')));
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
            text: 'Add Document Record',
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
            const Text('Submitted Documents:',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 8),
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: state.documents.length,
              itemBuilder: (context, index) {
                final doc = state.documents[index];
                final isDocVerified = doc.status == 'verified' || doc.status == 'approved';
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.grey[50],
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.grey[200]!),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        isDocVerified ? Icons.verified : Icons.hourglass_top,
                        color: isDocVerified ? AppColors.primaryGreen : Colors.amber,
                        size: 20,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              doc.type.replaceAll('_', ' '),
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                            ),
                            Text(
                              'Status: ${doc.status}',
                              style: TextStyle(color: Colors.grey[600], fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ],
        ],
      ),
    );
  }

  // --- Step 4: Vehicle Setup (Driver Profile ID Auto-Injected!) ---
  Widget _buildVehicleSection(DriverOnboardingState state) {
    final driverProfile = state.driverProfile;

    return InfurnusCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Step 4: Register Vehicle',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          const Text('Register your vehicle under your driver profile.',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 14),

          // Auto-Linked Profile Indicator (Eliminates manual UUID typing!)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: driverProfile != null ? Colors.green[50] : Colors.amber[50],
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: driverProfile != null ? Colors.green[200]! : Colors.amber[200]!,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  driverProfile != null ? Icons.link : Icons.warning_amber_rounded,
                  color: driverProfile != null ? AppColors.primaryGreen : Colors.amber[800],
                  size: 18,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    driverProfile != null
                        ? 'Auto-linked Profile: ${driverProfile.id.substring(0, 8)}...'
                        : 'Driver profile required. Please save Driver Profile in Step 2.',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: driverProfile != null ? AppColors.primaryGreen : Colors.amber[900],
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Sector selection (Passenger, Logistics, Service, Premium)
          DropdownButtonFormField<String>(
            value: _selectedSector,
            decoration: const InputDecoration(
              labelText: 'Vehicle Sector / Category',
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
            items: _sectors.map((sector) {
              return DropdownMenuItem(
                value: sector['id'],
                child: Text(sector['label']!),
              );
            }).toList(),
            onChanged: (val) {
              if (val != null) setState(() => _selectedSector = val);
            },
          ),
          const SizedBox(height: 12),

          Row(
            children: [
              Expanded(
                child: InfurnusTextField(
                  label: 'Make',
                  hintText: 'e.g. Maruti / Tata',
                  controller: _makeController,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InfurnusTextField(
                  label: 'Model',
                  hintText: 'e.g. Swift / Nexon',
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
              if (driverProfile == null) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Please save your Driver Profile in Step 2 first')),
                );
                return;
              }
              if (_makeController.text.trim().isEmpty ||
                  _modelController.text.trim().isEmpty ||
                  _plateNumberController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Please fill all required vehicle fields')),
                );
                return;
              }

              final success = await ref.read(driverOnboardingProvider.notifier).registerVehicle(
                    driverProfileId: driverProfile.id,
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

  // --- Step 5: Dashboard Access Button ---
  Widget _buildDashboardAccessButton() {
    return InfurnusButton(
      text: 'Go to Driver Dashboard',
      onPressed: () {
        ref.read(driverDashboardProvider.notifier).loadDashboard();
        context.go('/driver/dashboard');
      },
    );
  }
}
