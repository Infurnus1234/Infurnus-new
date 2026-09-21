class FareEstimateModel {
  final double grossAmount; // In ₹ (converted from paise)
  final double baseAmount;
  final double distanceAmount;
  final double timeAmount;
  final double distanceKm;
  final int durationMinutes;
  final String currency;

  final double? waitingAmount;
  final double? weightAmount;
  final double? loadingAmount;
  final double? fuelAmount;
  final double? taxAmount;

  FareEstimateModel({
    required this.grossAmount,
    required this.baseAmount,
    required this.distanceAmount,
    required this.timeAmount,
    this.waitingAmount,
    this.weightAmount,
    this.loadingAmount,
    this.fuelAmount,
    this.taxAmount,
    required this.distanceKm,
    required this.durationMinutes,
    required this.currency,
  });

  factory FareEstimateModel.fromJson(Map<String, dynamic> json) {
    final grossPaise = (json['grossAmount'] as num?)?.toDouble() ?? 0.0;
    final basePaise = (json['baseAmount'] as num?)?.toDouble() ?? 0.0;
    final distPaise = (json['distanceAmount'] as num?)?.toDouble() ?? 0.0;
    final timePaise = (json['timeAmount'] as num?)?.toDouble() ?? 0.0;
    final waitingPaise = (json['waitingAmount'] as num?)?.toDouble();
    final weightPaise = (json['weightAmount'] as num?)?.toDouble();
    final loadingPaise = (json['loadingAmount'] as num?)?.toDouble();
    final fuelPaise = (json['fuelAmount'] as num?)?.toDouble();
    final taxPaise = (json['taxAmount'] as num?)?.toDouble();
    final distMeters = (json['distanceMeters'] as num?)?.toDouble() ?? 0.0;
    final durSecs = (json['durationSeconds'] as num?)?.toInt() ?? 0;

    return FareEstimateModel(
      grossAmount: grossPaise > 0 ? (grossPaise / 100.0) : 0.0,
      baseAmount: basePaise > 0 ? (basePaise / 100.0) : 0.0,
      distanceAmount: distPaise > 0 ? (distPaise / 100.0) : 0.0,
      timeAmount: timePaise > 0 ? (timePaise / 100.0) : 0.0,
      waitingAmount: waitingPaise != null ? (waitingPaise / 100.0) : null,
      weightAmount: weightPaise != null ? (weightPaise / 100.0) : null,
      loadingAmount: loadingPaise != null ? (loadingPaise / 100.0) : null,
      fuelAmount: fuelPaise != null ? (fuelPaise / 100.0) : null,
      taxAmount: taxPaise != null ? (taxPaise / 100.0) : null,
      distanceKm: distMeters > 0 ? (distMeters / 1000.0) : 0.0,
      durationMinutes: (durSecs / 60.0).round(),
      currency: (json['currency'] as String?) ?? 'INR',
    );
  }
}
