enum RideStatus {
  requested,
  searching,
  driverAssigned,
  driverArriving,
  driverArrived,
  inProgress,
  completed,
  cancelled,
}

class RideLocation {
  final double latitude;
  final double longitude;

  RideLocation({required this.latitude, required this.longitude});

  Map<String, dynamic> toJson() => {
    'latitude': latitude,
    'longitude': longitude,
  };

  factory RideLocation.fromJson(Map<String, dynamic> json) {
    return RideLocation(
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
    );
  }
}

class DriverDetails {
  final String id;
  final String name;
  final String? phone;
  final double? rating;
  final String? photoUrl;

  DriverDetails({
    required this.id,
    required this.name,
    this.phone,
    this.rating,
    this.photoUrl,
  });

  factory DriverDetails.fromJson(Map<String, dynamic> json) {
    return DriverDetails(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      phone: null,
      rating: (json['rating'] as num?)?.toDouble(),
      photoUrl: json['photoUrl'] as String?,
    );
  }
}

class VehicleDetails {
  final String make;
  final String model;
  final String? color;
  final String plateNumber;

  VehicleDetails({
    required this.make,
    required this.model,
    this.color,
    required this.plateNumber,
  });

  factory VehicleDetails.fromJson(Map<String, dynamic> json) {
    return VehicleDetails(
      make: (json['make'] as String?) ?? '',
      model: (json['model'] as String?) ?? '',
      color: json['color'] as String?,
      plateNumber: (json['plateNumber'] as String?) ?? '',
    );
  }
}

/// A backend clock sample paired with elapsed time on this device.
class RideCancellationWindow {
  final DateTime deadline;
  final Duration _remainingAtReceipt;
  final Stopwatch _elapsed = Stopwatch()..start();

  RideCancellationWindow._(this.deadline, DateTime serverTime)
    : _remainingAtReceipt = deadline.difference(serverTime);

  static RideCancellationWindow? fromJson(Map<String, dynamic> json) {
    final deadline = DateTime.tryParse(
      json['customerCancellationDeadline'] as String? ?? '',
    );
    final serverTime = DateTime.tryParse(
      json['cancellationServerTime'] as String? ?? '',
    );
    if (deadline == null || serverTime == null) return null;
    return RideCancellationWindow._(deadline, serverTime);
  }

  Duration get remaining => _remainingAtReceipt - _elapsed.elapsed;
  int get remainingSeconds =>
      (remaining.inMicroseconds / Duration.microsecondsPerSecond).ceil().clamp(
        0,
        300,
      );
}

class RideModel {
  final String id;
  final String? bookingId;
  final String? callingNumber;
  final String customerId;
  final String? assignedDriverId;
  final String? assignedVehicleId;
  final RideLocation pickup;
  final RideLocation destination;
  final String? pickupAddress;
  final String? destinationAddress;
  final double? fareEstimate;
  final double? finalFare;
  final String? bookingVehicleTypeId;
  final String? bookingPricingVersion;
  final int? actualDistanceMeters;
  final double? actualFuelCost;
  final String? sector;
  final String? vehicleCategory;
  final Map<String, dynamic>? goods;
  final Map<String, dynamic>? serviceDetails;
  final Map<String, dynamic>? rentalDetails;
  final String? pin;
  final bool? pinVerified;
  final String? endPin;
  final bool? endPinVerified;
  final DriverDetails? driverDetails;
  final VehicleDetails? vehicleDetails;
  final RideStatus status;
  final String? paymentStatus;
  // Logistics upfront payment fields
  final String?
  upfrontPaymentStatus; // NOT_REQUIRED | PENDING | PAID_VERIFIED | FAILED
  final Map<String, dynamic>?
  logisticsPayment; // {upfrontAmount, remainingAmount, status, ...}
  final String? cancellationReason;
  final RideCancellationWindow? cancellationWindow;
  final String? logisticsSearchStatus;
  final DateTime? logisticsFulfillmentDeadline;
  final String? logisticsPickupStatus;
  final DateTime? cancelledAt;
  final DateTime? completedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  double get displayFare => finalFare ?? fareEstimate ?? 0.0;

  RideModel preserveEarlierCancellationExpiry(RideModel? previous) {
    final earlier = previous?.cancellationWindow;
    final incoming = cancellationWindow;
    if (id == previous?.id &&
        earlier != null &&
        incoming != null &&
        earlier.deadline == incoming.deadline &&
        earlier.remaining < incoming.remaining) {
      return copyWith(cancellationWindow: earlier);
    }
    return this;
  }

  bool get isLogistics => sector == 'logistics';
  bool get upfrontPaid => upfrontPaymentStatus == 'PAID_VERIFIED';
  double get upfrontAmount {
    final direct = logisticsPayment?['upfrontAmount'] as num?;
    if (direct != null) return direct.toDouble();
    return ((logisticsPayment?['upfrontPaise'] as num?)?.toDouble() ?? 0) / 100;
  }

  RideModel({
    this.bookingId,
    this.callingNumber,
    required this.id,
    required this.customerId,
    this.assignedDriverId,
    this.assignedVehicleId,
    required this.pickup,
    required this.destination,
    this.pickupAddress,
    this.destinationAddress,
    this.fareEstimate,
    this.finalFare,
    this.bookingVehicleTypeId,
    this.bookingPricingVersion,
    this.paymentStatus,
    this.upfrontPaymentStatus,
    this.logisticsPayment,
    this.actualDistanceMeters,
    this.actualFuelCost,
    this.sector,
    this.vehicleCategory,
    this.goods,
    this.serviceDetails,
    this.rentalDetails,
    this.pin,
    this.pinVerified,
    this.endPin,
    this.endPinVerified,
    this.driverDetails,
    this.vehicleDetails,
    required this.status,
    this.cancellationReason,
    this.cancellationWindow,
    this.logisticsSearchStatus,
    this.logisticsFulfillmentDeadline,
    this.logisticsPickupStatus,
    this.cancelledAt,
    this.completedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  RideModel copyWith({
    String? id,
    String? customerId,
    String? assignedDriverId,
    String? assignedVehicleId,
    RideLocation? pickup,
    RideLocation? destination,
    String? pickupAddress,
    String? destinationAddress,
    double? fareEstimate,
    double? finalFare,
    int? actualDistanceMeters,
    double? actualFuelCost,
    String? sector,
    String? vehicleCategory,
    Map<String, dynamic>? goods,
    Map<String, dynamic>? serviceDetails,
    Map<String, dynamic>? rentalDetails,
    String? pin,
    bool? pinVerified,
    String? endPin,
    bool? endPinVerified,
    DriverDetails? driverDetails,
    VehicleDetails? vehicleDetails,
    RideStatus? status,
    String? upfrontPaymentStatus,
    Map<String, dynamic>? logisticsPayment,
    String? cancellationReason,
    RideCancellationWindow? cancellationWindow,
    DateTime? cancelledAt,
    DateTime? completedAt,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return RideModel(
      logisticsSearchStatus: logisticsSearchStatus,
      logisticsFulfillmentDeadline: logisticsFulfillmentDeadline,
      logisticsPickupStatus: logisticsPickupStatus,
      id: id ?? this.id,
      bookingId: bookingId,
      callingNumber: callingNumber,
      customerId: customerId ?? this.customerId,
      assignedDriverId: assignedDriverId ?? this.assignedDriverId,
      assignedVehicleId: assignedVehicleId ?? this.assignedVehicleId,
      pickup: pickup ?? this.pickup,
      destination: destination ?? this.destination,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      destinationAddress: destinationAddress ?? this.destinationAddress,
      fareEstimate: fareEstimate ?? this.fareEstimate,
      finalFare: finalFare ?? this.finalFare,
      actualDistanceMeters: actualDistanceMeters ?? this.actualDistanceMeters,
      actualFuelCost: actualFuelCost ?? this.actualFuelCost,
      sector: sector ?? this.sector,
      vehicleCategory: vehicleCategory ?? this.vehicleCategory,
      goods: goods ?? this.goods,
      serviceDetails: serviceDetails ?? this.serviceDetails,
      rentalDetails: rentalDetails ?? this.rentalDetails,
      pin: pin ?? this.pin,
      pinVerified: pinVerified ?? this.pinVerified,
      endPin: endPin ?? this.endPin,
      endPinVerified: endPinVerified ?? this.endPinVerified,
      driverDetails: driverDetails ?? this.driverDetails,
      vehicleDetails: vehicleDetails ?? this.vehicleDetails,
      status: status ?? this.status,
      upfrontPaymentStatus: upfrontPaymentStatus ?? this.upfrontPaymentStatus,
      logisticsPayment: logisticsPayment ?? this.logisticsPayment,
      cancellationReason: cancellationReason ?? this.cancellationReason,
      cancellationWindow: cancellationWindow ?? this.cancellationWindow,
      cancelledAt: cancelledAt ?? this.cancelledAt,
      completedAt: completedAt ?? this.completedAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  factory RideModel.fromJson(Map<String, dynamic> json) {
    return RideModel(
      logisticsSearchStatus: json['logisticsSearchStatus'] as String?,
      logisticsFulfillmentDeadline: DateTime.tryParse(
        json['logisticsFulfillmentDeadline'] as String? ?? '',
      ),
      logisticsPickupStatus: json['logisticsPickupStatus'] as String?,
      id: json['id'] as String,
      bookingId: json['bookingId'] as String?,
      callingNumber: json['callingNumber'] as String?,
      customerId: json['customerId'] as String,
      assignedDriverId: json['assignedDriverId'] as String?,
      assignedVehicleId: json['assignedVehicleId'] as String?,
      pickup: RideLocation.fromJson(json['pickup'] as Map<String, dynamic>),
      destination: RideLocation.fromJson(
        json['destination'] as Map<String, dynamic>,
      ),
      pickupAddress: json['pickupAddress'] as String?,
      destinationAddress: json['destinationAddress'] as String?,
      fareEstimate: json['fareEstimate'] != null
          ? (json['fareEstimate'] as num).toDouble()
          : (json['fare'] != null ? (json['fare'] as num).toDouble() : null),
      finalFare: json['finalFare'] != null
          ? (json['finalFare'] as num).toDouble()
          : null,
      actualDistanceMeters: json['actualDistanceMeters'] != null
          ? (json['actualDistanceMeters'] as num).toInt()
          : null,
      actualFuelCost: json['actualFuelCost'] != null
          ? (json['actualFuelCost'] as num).toDouble()
          : null,
      sector: json['sector'] as String?,
      vehicleCategory: json['vehicleCategory'] as String?,
      bookingVehicleTypeId: json['bookingVehicleTypeId'] as String?,
      bookingPricingVersion: json['bookingPricingVersion'] as String?,
      goods: json['goods'] != null
          ? Map<String, dynamic>.from(json['goods'] as Map)
          : null,
      serviceDetails: json['serviceDetails'] != null
          ? Map<String, dynamic>.from(json['serviceDetails'] as Map)
          : null,
      rentalDetails: json['rentalDetails'] != null
          ? Map<String, dynamic>.from(json['rentalDetails'] as Map)
          : null,
      pin: json['pin'] as String?,
      pinVerified: json['pinVerified'] as bool?,
      endPin: json['endPin'] as String?,
      endPinVerified: json['endPinVerified'] as bool?,
      driverDetails: json['driverDetails'] != null
          ? DriverDetails.fromJson(
              json['driverDetails'] as Map<String, dynamic>,
            )
          : null,
      vehicleDetails: json['vehicleDetails'] != null
          ? VehicleDetails.fromJson(
              json['vehicleDetails'] as Map<String, dynamic>,
            )
          : null,
      status: _parseStatus(json['status'] as String),
      paymentStatus:
          json['paymentStatus'] as String? ??
          (json['payment'] is Map
              ? (json['payment'] as Map)['status'] as String?
              : null),
      upfrontPaymentStatus: json['upfrontPaymentStatus'] as String?,
      logisticsPayment: json['logisticsPayment'] != null
          ? Map<String, dynamic>.from(json['logisticsPayment'] as Map)
          : null,
      cancellationReason: json['cancellationReason'] as String?,
      cancellationWindow: RideCancellationWindow.fromJson(json),
      cancelledAt: json['cancelledAt'] != null
          ? DateTime.parse(json['cancelledAt'] as String)
          : null,
      completedAt: json['completedAt'] != null
          ? DateTime.parse(json['completedAt'] as String)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  static RideStatus _parseStatus(String status) {
    switch (status) {
      case 'requested':
        return RideStatus.requested;
      case 'searching':
        return RideStatus.searching;
      case 'driver_assigned':
        return RideStatus.driverAssigned;
      case 'driver_arriving':
        return RideStatus.driverArriving;
      case 'driver_arrived':
        return RideStatus.driverArrived;
      case 'in_progress':
        return RideStatus.inProgress;
      case 'completed':
        return RideStatus.completed;
      case 'cancelled':
        return RideStatus.cancelled;
      default:
        return RideStatus.requested;
    }
  }
}
