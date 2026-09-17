import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../providers/driver_dashboard_provider.dart';
import '../providers/driver_onboarding_provider.dart';

class DriverDocumentsScreen extends ConsumerStatefulWidget {
  const DriverDocumentsScreen({super.key});

  @override
  ConsumerState<DriverDocumentsScreen> createState() => _DriverDocumentsScreenState();
}

class _DriverDocumentsScreenState extends ConsumerState<DriverDocumentsScreen> {
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
    _issuedAtController.dispose();
    _expiresAtController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final onboardingState = ref.watch(driverOnboardingProvider);
    final partner = ref.watch(driverDashboardProvider).partner;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner Documents (Metadata)'),
      ),
      body: onboardingState.isLoading
          ? const InfurnusLoader(message: 'Loading Documents...')
          : partner == null
              ? const Center(child: Text('Partner Profile required.'))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (onboardingState.errorMessage != null)
                        _buildErrorBanner(onboardingState.errorMessage!),
                      if (onboardingState.successMessage != null)
                        _buildSuccessBanner(onboardingState.successMessage!),

                      // Document Metadata Add Form
                      InfurnusCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Add Document Metadata', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 12),
                            DropdownButtonFormField<String>(
                              value: _selectedDocType,
                              decoration: const InputDecoration(
                                labelText: 'Document Type',
                                border: OutlineInputBorder(),
                                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                              ),
                              items: _docTypes.map((type) => DropdownMenuItem(value: type, child: Text(type))).toList(),
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
                              text: 'Submit Metadata',
                              isLoading: onboardingState.isSubmitting,
                              onPressed: () {
                                ref.read(driverOnboardingProvider.notifier).addDocumentMetadata(
                                      documentType: _selectedDocType,
                                      issuedAt: _issuedAtController.text.trim(),
                                      expiresAt: _expiresAtController.text.trim(),
                                    );
                              },
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 24),
                      const Text('Submitted Documents', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 12),

                      if (onboardingState.documents.isEmpty)
                        const Center(child: Text('No documents submitted yet.'))
                      else
                        ListView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: onboardingState.documents.length,
                          itemBuilder: (context, index) {
                            final doc = onboardingState.documents[index];
                            return Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              child: InfurnusCard(
                                child: ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(Icons.file_present, color: AppColors.primaryGreen, size: 32),
                                  title: Text(doc.type, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                                  subtitle: Text('Status: ${doc.status}\nIssued: ${doc.issuedAt ?? "N/A"} | Expires: ${doc.expiresAt ?? "N/A"}'),
                                ),
                              ),
                            );
                          },
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
}
