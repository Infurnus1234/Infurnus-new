class VehicleModel {
  final String id;
  final String? ownerId;
  final String? driverProfileId;
  final String make;
  final String model;
  final String? color;
  final String plateNumber;
  final String sector;
  final String category;
  final double fuelRatePerKm;
  final double loadCapacityKg;
  final int? year;
  final String? fuelType;
  final int? seatingCapacity;
  final bool isCommercial;
  final String verificationStatus;
  final bool isActive;
  final String? activeAssignmentCode;
  final DateTime? retiredAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  VehicleModel({
    required this.id,
    this.ownerId,
    this.driverProfileId,
    required this.make,
    required this.model,
    this.color,
    required this.plateNumber,
    this.sector = 'passenger',
    this.category = 'sedan',
    this.fuelRatePerKm = 0.0,
    this.loadCapacityKg = 0.0,
    this.year,
    this.fuelType,
    this.seatingCapacity,
    this.isCommercial = true,
    this.verificationStatus = 'approved',
    required this.isActive,
    this.activeAssignmentCode,
    this.retiredAt,
    this.createdAt,
    this.updatedAt,
  });

  factory VehicleModel.fromJson(Map<String, dynamic> json) {
    return VehicleModel(
      id: json['id'] as String,
      ownerId: json['ownerId'] as String?,
      driverProfileId: json['driverProfileId'] as String?,
      make: json['make'] as String? ?? '',
      model: json['model'] as String? ?? '',
      color: json['color'] as String?,
      plateNumber: json['plateNumber'] as String? ?? '',
      sector: json['sector'] as String? ?? 'passenger',
      category: json['category'] as String? ?? 'sedan',
      fuelRatePerKm: (json['fuelRatePerKm'] as num?)?.toDouble() ?? 0.0,
      loadCapacityKg: (json['loadCapacityKg'] as num?)?.toDouble() ?? 0.0,
      year: json['year'] as int?,
      fuelType: json['fuelType'] as String?,
      seatingCapacity: json['seatingCapacity'] as int?,
      isCommercial: json['isCommercial'] as bool? ?? true,
      verificationStatus: json['verificationStatus'] as String? ?? 'approved',
      isActive: json['isActive'] as bool? ?? true,
      activeAssignmentCode: json['activeAssignmentCode'] as String?,
      retiredAt: json['retiredAt'] != null ? DateTime.parse(json['retiredAt'] as String) : null,
      createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt'] as String) : null,
      updatedAt: json['updatedAt'] != null ? DateTime.parse(json['updatedAt'] as String) : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ownerId': ownerId,
        'driverProfileId': driverProfileId,
        'make': make,
        'model': model,
        'color': color,
        'plateNumber': plateNumber,
        'sector': sector,
        'category': category,
        'fuelRatePerKm': fuelRatePerKm,
        'loadCapacityKg': loadCapacityKg,
        'year': year,
        'fuelType': fuelType,
        'seatingCapacity': seatingCapacity,
        'isCommercial': isCommercial,
        'verificationStatus': verificationStatus,
        'isActive': isActive,
        'activeAssignmentCode': activeAssignmentCode,
        'retiredAt': retiredAt?.toIso8601String(),
        'createdAt': createdAt?.toIso8601String(),
        'updatedAt': updatedAt?.toIso8601String(),
      };
}
