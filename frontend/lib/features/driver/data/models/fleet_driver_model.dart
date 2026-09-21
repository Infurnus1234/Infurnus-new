class FleetDriverModel {
  final String id;
  final String userId;
  final String name;
  final String phone;
  final String? email;
  final String licenseNumber;
  final String licenseExpiry;
  final String verificationStatus;
  final String? availabilityStatus;
  final Map<String, dynamic>? assignedVehicle;
  final int completedTrips;
  final double totalEarnings;

  FleetDriverModel({
    required this.id,
    required this.userId,
    required this.name,
    required this.phone,
    this.email,
    required this.licenseNumber,
    required this.licenseExpiry,
    required this.verificationStatus,
    this.availabilityStatus,
    this.assignedVehicle,
    required this.completedTrips,
    required this.totalEarnings,
  });

  factory FleetDriverModel.fromJson(Map<String, dynamic> json) {
    return FleetDriverModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      name: json['name'] as String? ?? 'Driver',
      phone: json['phone'] as String? ?? '',
      email: json['email'] as String?,
      licenseNumber: json['licenseNumber'] as String? ?? '',
      licenseExpiry: json['licenseExpiry'] as String? ?? '',
      verificationStatus: json['verificationStatus'] as String? ?? 'approved',
      availabilityStatus: json['availabilityStatus'] as String?,
      assignedVehicle: json['assignedVehicle'] as Map<String, dynamic>?,
      completedTrips: json['completedTrips'] as int? ?? 0,
      totalEarnings: (json['totalEarnings'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
