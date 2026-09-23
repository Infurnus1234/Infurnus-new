class FleetVehicleModel {
  final String id;
  final String make;
  final String model;
  final String? color;
  final String sector;
  final String category;
  final double fuelRatePerKm;
  final int loadCapacityKg;

  FleetVehicleModel({
    required this.id,
    required this.make,
    required this.model,
    this.color,
    required this.sector,
    required this.category,
    required this.fuelRatePerKm,
    required this.loadCapacityKg,
  });

  factory FleetVehicleModel.fromJson(Map<String, dynamic> json) {
    return FleetVehicleModel(
      id: json['id'] as String,
      make: json['make'] as String,
      model: json['model'] as String,
      color: json['color'] as String?,
      sector: json['sector'] as String,
      category: json['category'] as String,
      fuelRatePerKm: (json['fuelRatePerKm'] as num?)?.toDouble() ?? 0.0,
      loadCapacityKg: (json['loadCapacityKg'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'make': make,
    'model': model,
    'color': color,
    'sector': sector,
    'category': category,
    'fuelRatePerKm': fuelRatePerKm,
    'loadCapacityKg': loadCapacityKg,
  };
}
