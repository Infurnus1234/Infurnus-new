class FareEstimateModel {
  final String estimateType;
  final bool bookable;
  final String? message;
  final FareEstimateModel? minimum;
  final FareEstimateModel? maximum;
  final FareEstimateModel? bookingQuote;
  final String? pricingDescription;

  bool get isRange => estimateType == 'range';
  bool get isUnavailable =>
      estimateType == 'unavailable' || estimateType == 'quote_required';
  double? get bookingAmount {
    if (!bookable || isUnavailable || currency != 'INR') return null;
    final amount = bookingQuote?.grossAmount ?? (isRange ? null : grossAmount);
    return amount != null && amount.isFinite && amount >= 0 ? amount : null;
  }

  String get displayFare {
    if (isUnavailable) return 'Fare unavailable';
    if (isRange && minimum != null) {
      return maximum == null
          ? '₹${minimum!.grossAmount.toStringAsFixed(2)}+'
          : '₹${minimum!.grossAmount.toStringAsFixed(2)}–₹${maximum!.grossAmount.toStringAsFixed(2)}';
    }
    return '₹${grossAmount.toStringAsFixed(2)}';
  }

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
    this.estimateType = 'fixed',
    this.bookable = true,
    this.message,
    this.minimum,
    this.maximum,
    this.bookingQuote,
    this.pricingDescription,
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

  factory FareEstimateModel.fromJson(dynamic value) {
    if (value is! Map<String, dynamic>) {
      throw const FormatException('Invalid fare response.');
    }
    final json = value;
    if (json['currency'] != 'INR' ||
        (json.containsKey('bookable') && json['bookable'] is! bool)) {
      throw const FormatException('Invalid fare currency or booking flag.');
    }
    double number(dynamic value, String field, {bool money = false}) {
      if (value is! num ||
          !value.isFinite ||
          value < 0 ||
          (money &&
              (value > 9007199254740991 || value != value.roundToDouble()))) {
        throw FormatException('Invalid fare field: $field');
      }
      return value.toDouble();
    }

    FareEstimateModel scalar(dynamic value) {
      if (value is! Map<String, dynamic> || value['estimateType'] != null) {
        throw const FormatException('Invalid scalar fare breakdown.');
      }
      return FareEstimateModel.fromJson(value);
    }

    final type = json['estimateType'];
    if (type != null && type != 'range' && type != 'quote_required') {
      throw const FormatException('Unknown fare estimate type.');
    }
    if (json['estimateType'] == 'range' ||
        json['estimateType'] == 'quote_required') {
      final range = json['estimatedFare'] as Map<String, dynamic>?;
      final minimum = range?['minimum'] is Map<String, dynamic>
          ? scalar(range!['minimum'])
          : null;
      final maximum = range?['maximum'] is Map<String, dynamic>
          ? scalar(range!['maximum'])
          : null;
      final quote = json['bookingFare'] is Map<String, dynamic>
          ? scalar(json['bookingFare'])
          : null;
      final pricing = json['pricing'] as Map<String, dynamic>?;
      if (json['estimateType'] == 'range' && minimum == null) {
        throw const FormatException(
          'Fare range is missing its minimum estimate.',
        );
      }
      if ((range?['maximum'] != null && maximum == null) ||
          (json['bookingFare'] != null && quote == null) ||
          (maximum != null &&
              (minimum == null || maximum.grossAmount < minimum.grossAmount)) ||
          (json['bookable'] == true && (type != 'range' || quote == null)) ||
          (quote != null &&
              minimum != null &&
              (quote.grossAmount < minimum.grossAmount ||
                  (maximum != null &&
                      quote.grossAmount > maximum.grossAmount)))) {
        throw const FormatException(
          'Inconsistent fare range or booking quote.',
        );
      }
      String moneyRange(Map<String, dynamic> value) {
        final min =
            number(value['minimum'], 'pricing minimum', money: true) / 100;
        final max = value['maximum'] == null
            ? null
            : number(value['maximum'], 'pricing maximum', money: true);
        if (max != null && max / 100 < min) {
          throw const FormatException('Reversed pricing range.');
        }
        return max == null
            ? '₹${min.toStringAsFixed(2)}+'
            : '₹${min.toStringAsFixed(2)}–₹${(max / 100).toStringAsFixed(2)}';
      }

      final base = pricing?['baseFare'] as Map<String, dynamic>?;
      final rate = pricing?['perKmRate'] as Map<String, dynamic>?;
      if (rate == null ||
          rate['maximum'] == null ||
          (type == 'range' &&
              (base == null || (base['maximum'] != null && maximum == null))) ||
          (type == 'quote_required' && (range != null || quote != null))) {
        throw const FormatException('Incomplete vehicle pricing response.');
      }
      for (final field in ['distanceMeters', 'durationSeconds']) {
        number(json[field], field);
      }
      return FareEstimateModel(
        estimateType: json['estimateType'] as String,
        bookable:
            json['estimateType'] == 'range' &&
            json['bookable'] == true &&
            quote != null,
        message: json['message'] as String?,
        minimum: minimum,
        maximum: maximum,
        bookingQuote: quote,
        pricingDescription:
            '${base == null ? "Route-based base" : "Base ${moneyRange(base)}"}; ${moneyRange(rate)}/km',
        grossAmount: quote?.grossAmount ?? 0,
        baseAmount: 0,
        distanceAmount: 0,
        timeAmount: 0,
        distanceKm: (json['distanceMeters'] as num).toDouble() / 1000,
        durationMinutes: ((json['durationSeconds'] as num).toDouble() / 60)
            .round(),
        currency: json['currency'] as String,
      );
    }
    for (final field in [
      'grossAmount',
      'baseAmount',
      'distanceAmount',
      'timeAmount',
    ]) {
      number(json[field], field, money: true);
    }
    for (final field in [
      'waitingAmount',
      'weightAmount',
      'loadingAmount',
      'fuelAmount',
      'taxAmount',
    ]) {
      if (json[field] != null) number(json[field], field, money: true);
    }
    for (final field in ['distanceMeters', 'durationSeconds']) {
      number(json[field], field);
    }
    final grossPaise = (json['grossAmount'] as num).toDouble();
    final basePaise = (json['baseAmount'] as num).toDouble();
    final distPaise = (json['distanceAmount'] as num).toDouble();
    final timePaise = (json['timeAmount'] as num).toDouble();
    final waitingPaise = (json['waitingAmount'] as num?)?.toDouble();
    final weightPaise = (json['weightAmount'] as num?)?.toDouble();
    final loadingPaise = (json['loadingAmount'] as num?)?.toDouble();
    final fuelPaise = (json['fuelAmount'] as num?)?.toDouble();
    final taxPaise = (json['taxAmount'] as num?)?.toDouble();
    final distMeters = (json['distanceMeters'] as num).toDouble();
    final durSecs = (json['durationSeconds'] as num).toInt();

    return FareEstimateModel(
      bookable: json['bookable'] != false,
      grossAmount: grossPaise / 100.0,
      baseAmount: basePaise / 100.0,
      distanceAmount: distPaise / 100.0,
      timeAmount: timePaise / 100.0,
      waitingAmount: waitingPaise != null ? (waitingPaise / 100.0) : null,
      weightAmount: weightPaise != null ? (weightPaise / 100.0) : null,
      loadingAmount: loadingPaise != null ? (loadingPaise / 100.0) : null,
      fuelAmount: fuelPaise != null ? (fuelPaise / 100.0) : null,
      taxAmount: taxPaise != null ? (taxPaise / 100.0) : null,
      distanceKm: distMeters > 0 ? (distMeters / 1000.0) : 0.0,
      durationMinutes: (durSecs / 60.0).round(),
      currency: json['currency'] as String,
    );
  }

  factory FareEstimateModel.unavailable(String message) => FareEstimateModel(
    estimateType: 'unavailable',
    bookable: false,
    message: message,
    grossAmount: 0,
    baseAmount: 0,
    distanceAmount: 0,
    timeAmount: 0,
    distanceKm: 0,
    durationMinutes: 0,
    currency: 'INR',
  );
}
