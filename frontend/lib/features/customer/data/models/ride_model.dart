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

class RideModel {
  final String id;
  final String customerId;
  final String? assignedDriverId;
  final String? assignedVehicleId;
  final RideLocation pickup;
  final RideLocation destination;
  final String? pickupAddress;
  final String? destinationAddress;
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
