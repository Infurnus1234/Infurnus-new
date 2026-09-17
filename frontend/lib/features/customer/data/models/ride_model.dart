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
      phone: json['phone'] as String?,
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

class RideModel {
  final String id;
  final String customerId;
  final String? assignedDriverId;
  final String? assignedVehicleId;
  final RideLocation pickup;
  final RideLocation destination;
  final String? pickupAddress;
  final String? destinationAddress;
  final double? fareEstimate;
  final String? sector;
  final String? vehicleCategory;
  final Map<String, dynamic>? goods;
  final Map<String, dynamic>? serviceDetails;
  final Map<String, dynamic>? rentalDetails;
  final String? pin;
  final DriverDetails? driverDetails;
  final VehicleDetails? vehicleDetails;
  final RideStatus status;
  final String? cancellationReason;
  final DateTime? cancelledAt;
  final DateTime? completedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  RideModel({
    required this.id,
    required this.customerId,
    this.assignedDriverId,
    this.assignedVehicleId,
    required this.pickup,
    required this.destination,
    this.pickupAddress,
    this.destinationAddress,
    this.fareEstimate,
    this.sector,
    this.vehicleCategory,
    this.goods,
    this.serviceDetails,
    this.rentalDetails,
    this.pin,
    this.driverDetails,
    this.vehicleDetails,
    required this.status,
    this.cancellationReason,
    this.cancelledAt,
    this.completedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  factory RideModel.fromJson(Map<String, dynamic> json) {
    return RideModel(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      assignedDriverId: json['assignedDriverId'] as String?,
      assignedVehicleId: json['assignedVehicleId'] as String?,
      pickup: RideLocation.fromJson(json['pickup'] as Map<String, dynamic>),
      destination: RideLocation.fromJson(json['destination'] as Map<String, dynamic>),
      pickupAddress: json['pickupAddress'] as String?,
      destinationAddress: json['destinationAddress'] as String?,
      fareEstimate: json['fareEstimate'] != null
          ? (json['fareEstimate'] as num).toDouble()
          : (json['fare'] != null ? (json['fare'] as num).toDouble() : null),
      sector: json['sector'] as String?,
      vehicleCategory: json['vehicleCategory'] as String?,
      goods: json['goods'] != null ? Map<String, dynamic>.from(json['goods'] as Map) : null,
      serviceDetails: json['serviceDetails'] != null ? Map<String, dynamic>.from(json['serviceDetails'] as Map) : null,
      rentalDetails: json['rentalDetails'] != null ? Map<String, dynamic>.from(json['rentalDetails'] as Map) : null,
      pin: json['pin'] as String?,
      driverDetails: json['driverDetails'] != null
          ? DriverDetails.fromJson(json['driverDetails'] as Map<String, dynamic>)
          : null,
      vehicleDetails: json['vehicleDetails'] != null
          ? VehicleDetails.fromJson(json['vehicleDetails'] as Map<String, dynamic>)
          : null,
      status: _parseStatus(json['status'] as String),
      cancellationReason: json['cancellationReason'] as String?,
      cancelledAt: json['cancelledAt'] != null ? DateTime.parse(json['cancelledAt'] as String) : null,
      completedAt: json['completedAt'] != null ? DateTime.parse(json['completedAt'] as String) : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  static RideStatus _parseStatus(String status) {
    switch (status) {
      case 'requested': return RideStatus.requested;
      case 'searching': return RideStatus.searching;
      case 'driver_assigned': return RideStatus.driverAssigned;
      case 'driver_arriving': return RideStatus.driverArriving;
      case 'driver_arrived': return RideStatus.driverArrived;
      case 'in_progress': return RideStatus.inProgress;
      case 'completed': return RideStatus.completed;
      case 'cancelled': return RideStatus.cancelled;
      default: return RideStatus.requested;
    }
  }
}
