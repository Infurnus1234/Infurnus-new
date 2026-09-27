class FleetVehicleModel {
  final String id;
  final String make;
  final String model;
  final String? color;
  final String sector;
  final String category;
  final double fuelRatePerKm;
  final int loadCapacityKg;

  // Dynamic vehicle attributes (can be backend-provided or expanded)
  final String? name;
  final String? imageUrl;
  final String? fuelType;
  final String? mileage;
  final String? range;
  final double? pricing;
  final double? perKmCost;
  final Map<String, dynamic>? attributes;

  FleetVehicleModel({
    required this.id,
    required this.make,
    required this.model,
    this.color,
    required this.sector,
    required this.category,
    required this.fuelRatePerKm,
    required this.loadCapacityKg,
    this.name,
    this.imageUrl,
    this.fuelType,
    this.mileage,
    this.range,
    this.pricing,
    this.perKmCost,
    this.attributes,
  });

  String get displayName => (name != null && name!.isNotEmpty) ? name! : '$make $model'.trim();
  double get effectivePerKmCost => perKmCost ?? fuelRatePerKm;

  factory FleetVehicleModel.fromJson(Map<String, dynamic> json) {
    return FleetVehicleModel(
      id: json['id'] as String,
      make: json['make'] as String? ?? '',
      model: json['model'] as String? ?? '',
      color: json['color'] as String?,
      sector: json['sector'] as String? ?? 'passenger',
      category: json['category'] as String? ?? 'sedan',
      fuelRatePerKm: (json['fuelRatePerKm'] as num?)?.toDouble() ?? 0.0,
      loadCapacityKg: (json['loadCapacityKg'] as num?)?.toInt() ?? 0,
      name: json['name'] as String?,
      imageUrl: json['imageUrl'] as String? ?? json['vehicleImage'] as String?,
      fuelType: json['fuelType'] as String?,
      mileage: json['mileage'] as String?,
      range: json['range'] as String?,
      pricing: (json['pricing'] as num?)?.toDouble() ?? (json['basePrice'] as num?)?.toDouble(),
      perKmCost: (json['perKmCost'] as num?)?.toDouble(),
      attributes: json['attributes'] as Map<String, dynamic>?,
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
    if (name != null) 'name': name,
    if (imageUrl != null) 'imageUrl': imageUrl,
    if (fuelType != null) 'fuelType': fuelType,
    if (mileage != null) 'mileage': mileage,
    if (range != null) 'range': range,
    if (pricing != null) 'pricing': pricing,
    if (perKmCost != null) 'perKmCost': perKmCost,
    if (attributes != null) 'attributes': attributes,
  };
}
