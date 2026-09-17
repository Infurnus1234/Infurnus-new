import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../../data/models/partner_document_model.dart';
import '../../data/models/partner_model.dart';
import 'driver_providers.dart';

class DriverOnboardingState {
  final bool isLoading;
  final bool isSubmitting;
  final String? errorMessage;
  final String? successMessage;
  final PartnerModel? partner;
  final List<PartnerDocumentModel> documents;

  DriverOnboardingState({
    this.isLoading = false,
    this.isSubmitting = false,
    this.errorMessage,
    this.successMessage,
    this.partner,
    this.documents = const [],
  });

  DriverOnboardingState copyWith({
    bool? isLoading,
    bool? isSubmitting,
    String? errorMessage,
    String? successMessage,
    PartnerModel? partner,
    List<PartnerDocumentModel>? documents,
  }) {
    return DriverOnboardingState(
      isLoading: isLoading ?? this.isLoading,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: errorMessage,
      successMessage: successMessage,
      partner: partner ?? this.partner,
      documents: documents ?? this.documents,
    );
  }
}

class DriverOnboardingNotifier extends StateNotifier<DriverOnboardingState> {
  final Ref ref;

  DriverOnboardingNotifier(this.ref) : super(DriverOnboardingState());

  Future<void> loadOnboardingData() async {
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      final storage = ref.read(secureStorageProvider);
      final partnerId = await storage.read(key: 'partner_id');

      if (partnerId == null || partnerId.isEmpty) {
        state = state.copyWith(isLoading: false, partner: null, documents: []);
        return;
      }

      final partner = await ref.read(getPartnerUseCaseProvider).execute(partnerId);
      final docs = await ref.read(listPartnerDocumentsUseCaseProvider).execute(partnerId);

      state = state.copyWith(
        isLoading: false,
        partner: partner,
        documents: docs,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: e.toString(),
      );
    }
  }

  Future<bool> createPartnerProfile({
    required String businessName,
    String? businessDescription,
  }) async {
    final user = ref.read(userProvider);
    if (user == null) {
      state = state.copyWith(errorMessage: 'User not authenticated');
      return false;
    }

    state = state.copyWith(isSubmitting: true, errorMessage: null, successMessage: null);

    try {
      final requestData = {
        'userId': user.id,
        'businessName': businessName.trim(),
        if (businessDescription != null && businessDescription.isNotEmpty)
          'businessDescription': businessDescription.trim(),
      };

      final partner = await ref.read(becomePartnerUseCaseProvider).execute(requestData);

      // Persist partner_id in secure storage
      await ref.read(secureStorageProvider).write(key: 'partner_id', value: partner.id);

      state = state.copyWith(
        isSubmitting: false,
        partner: partner,
        successMessage: 'Partner profile created successfully!',
      );
      return true;
    } catch (e) {
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e.toString(),
      );
      return false;
    }
  }

  Future<bool> addDocumentMetadata({
    required String documentType,
    String? issuedAt,
    String? expiresAt,
  }) async {
    if (state.partner == null) {
      state = state.copyWith(errorMessage: 'Partner profile required before adding documents');
      return false;
    }

    state = state.copyWith(isSubmitting: true, errorMessage: null, successMessage: null);

    try {
      final docData = <String, dynamic>{
        'documentType': documentType,
        if (issuedAt != null && issuedAt.isNotEmpty) 'issuedAt': issuedAt,
        if (expiresAt != null && expiresAt.isNotEmpty) 'expiresAt': expiresAt,
      };

      final newDoc = await ref
          .read(addPartnerDocumentUseCaseProvider)
          .execute(state.partner!.id, docData);

      final updatedDocs = [...state.documents, newDoc];

      state = state.copyWith(
        isSubmitting: false,
        documents: updatedDocs,
        successMessage: 'Document metadata added successfully!',
      );
      return true;
    } catch (e) {
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e.toString(),
      );
      return false;
    }
  }

  Future<bool> registerVehicle({
    required String driverProfileId,
    required String make,
    required String model,
    String? color,
    required String plateNumber,
  }) async {
    state = state.copyWith(isSubmitting: true, errorMessage: null, successMessage: null);

    try {
      final vehicleData = {
        'driverProfileId': driverProfileId,
        'make': make.trim(),
        'model': model.trim(),
        if (color != null && color.isNotEmpty) 'color': color.trim(),
        'plateNumber': plateNumber.trim(),
      };

      await ref.read(createVehicleUseCaseProvider).execute(vehicleData);

      state = state.copyWith(
        isSubmitting: false,
        successMessage: 'Vehicle registered successfully!',
      );
      return true;
    } catch (e) {
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: e.toString(),
      );
      return false;
    }
  }
}

final driverOnboardingProvider =
    StateNotifierProvider<DriverOnboardingNotifier, DriverOnboardingState>((ref) {
  return DriverOnboardingNotifier(ref);
});
