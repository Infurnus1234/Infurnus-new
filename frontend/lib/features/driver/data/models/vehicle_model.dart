class VehicleModel {
  final String id;
  final String driverProfileId;
  final String make;
  final String model;
  final String? color;
  final String plateNumber;
  final bool isActive;
  final DateTime? retiredAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  VehicleModel({
    required this.id,
    required this.driverProfileId,
    required this.make,
    required this.model,
    this.color,
    required this.plateNumber,
    required this.isActive,
    this.retiredAt,
    required this.createdAt,
    required this.updatedAt,
  });

  factory VehicleModel.fromJson(Map<String, dynamic> json) {
    return VehicleModel(
      id: json['id'] as String,
      driverProfileId: json['driverProfileId'] as String,
      make: json['make'] as String,
      model: json['model'] as String,
      color: json['color'] as String?,
      plateNumber: json['plateNumber'] as String,
      isActive: json['isActive'] as bool,
      retiredAt: json['retiredAt'] != null ? DateTime.parse(json['retiredAt'] as String) : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'driverProfileId': driverProfileId,
        'make': make,
        'model': model,
        'color': color,
        'plateNumber': plateNumber,
        'isActive': isActive,
        'retiredAt': retiredAt?.toIso8601String(),
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };
}
