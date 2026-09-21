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
  final String? dob;
  final String? gender;
  final String? address;
  final String? city;
  final String? state;
  final String? pinCode;
  final String? emergencyContactName;
  final String? emergencyContactPhone;
  final String? activeVehicleId;
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
    this.dob,
    this.gender,
    this.address,
    this.city,
    this.state,
    this.pinCode,
    this.emergencyContactName,
    this.emergencyContactPhone,
    this.activeVehicleId,
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
      dob: json['dob'] as String?,
      gender: json['gender'] as String?,
      address: json['address'] as String?,
      city: json['city'] as String?,
      state: json['state'] as String?,
      pinCode: json['pinCode'] as String?,
      emergencyContactName: json['emergencyContactName'] as String?,
      emergencyContactPhone: json['emergencyContactPhone'] as String?,
      activeVehicleId: json['activeVehicleId'] as String?,
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
        'dob': dob,
        'gender': gender,
        'address': address,
        'city': city,
        'state': state,
        'pinCode': pinCode,
        'emergencyContactName': emergencyContactName,
        'emergencyContactPhone': emergencyContactPhone,
        'activeVehicleId': activeVehicleId,
      };
}
