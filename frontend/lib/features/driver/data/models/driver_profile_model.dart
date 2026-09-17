class DriverProfileModel {
  final String id;
  final String userId;
  final String licenseNumber;
  final String licenseExpiry;
  final String? licenseDocumentKey;
  final String? vehicleRcDocumentKey;
  final String? profilePhotoKey;
  final String verificationStatus;
  final String? rejectionReason;
  final String? availabilityStatus;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  DriverProfileModel({
    required this.id,
    required this.userId,
    required this.licenseNumber,
    required this.licenseExpiry,
    this.licenseDocumentKey,
    this.vehicleRcDocumentKey,
    this.profilePhotoKey,
    required this.verificationStatus,
    this.rejectionReason,
    this.availabilityStatus,
    this.createdAt,
    this.updatedAt,
  });

  factory DriverProfileModel.fromJson(Map<String, dynamic> json) {
    return DriverProfileModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      licenseNumber: json['licenseNumber'] as String,
      licenseExpiry: json['licenseExpiry'] as String,
      licenseDocumentKey: json['licenseDocumentKey'] as String?,
      vehicleRcDocumentKey: json['vehicleRcDocumentKey'] as String?,
      profilePhotoKey: json['profilePhotoKey'] as String?,
      verificationStatus: (json['verificationStatus'] as String?) ?? 'pending',
      rejectionReason: json['rejectionReason'] as String?,
      availabilityStatus: json['availabilityStatus'] as String?,
      createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt'] as String) : null,
      updatedAt: json['updatedAt'] != null ? DateTime.parse(json['updatedAt'] as String) : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'userId': userId,
        'licenseNumber': licenseNumber,
        'licenseExpiry': licenseExpiry,
        'licenseDocumentKey': licenseDocumentKey,
        'vehicleRcDocumentKey': vehicleRcDocumentKey,
        'profilePhotoKey': profilePhotoKey,
        'verificationStatus': verificationStatus,
        'rejectionReason': rejectionReason,
        'availabilityStatus': availabilityStatus,
      };
}
