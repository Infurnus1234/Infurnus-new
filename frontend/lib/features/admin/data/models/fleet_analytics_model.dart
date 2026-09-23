class FleetAnalyticsSummaryModel {
  final int totalVehicles;
  final int activeVehicles;
  final int onTripVehicles;
  final int offlineVehicles;
  final double activePercentage;

  const FleetAnalyticsSummaryModel({
    required this.totalVehicles,
    required this.activeVehicles,
    required this.onTripVehicles,
    required this.offlineVehicles,
    required this.activePercentage,
  });

  factory FleetAnalyticsSummaryModel.fromJson(Map<String, dynamic> json) {
    return FleetAnalyticsSummaryModel(
      totalVehicles: json['totalVehicles'] as int? ?? 0,
      activeVehicles: json['activeVehicles'] as int? ?? 0,
      onTripVehicles: json['onTripVehicles'] as int? ?? 0,
      offlineVehicles: json['offlineVehicles'] as int? ?? 0,
      activePercentage: (json['activePercentage'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class StateFleetAnalyticsModel {
  final String state;
  final int total;
  final int active;
  final int onTrip;
  final int offline;

  const StateFleetAnalyticsModel({
    required this.state,
    required this.total,
    required this.active,
    required this.onTrip,
    required this.offline,
  });

  factory StateFleetAnalyticsModel.fromJson(Map<String, dynamic> json) {
    return StateFleetAnalyticsModel(
      state: json['state'] as String? ?? 'Bihar',
      total: json['total'] as int? ?? 0,
      active: json['active'] as int? ?? 0,
      onTrip: json['onTrip'] as int? ?? 0,
      offline: json['offline'] as int? ?? 0,
    );
  }
}

class CityFleetAnalyticsModel {
  final String state;
  final String city;
  final int total;
  final int active;
  final int onTrip;
  final int offline;

  const CityFleetAnalyticsModel({
    required this.state,
    required this.city,
    required this.total,
    required this.active,
    required this.onTrip,
    required this.offline,
  });

  factory CityFleetAnalyticsModel.fromJson(Map<String, dynamic> json) {
    return CityFleetAnalyticsModel(
      state: json['state'] as String? ?? 'Bihar',
      city: json['city'] as String? ?? 'Patna',
      total: json['total'] as int? ?? 0,
      active: json['active'] as int? ?? 0,
      onTrip: json['onTrip'] as int? ?? 0,
      offline: json['offline'] as int? ?? 0,
    );
  }
}

class LiveFleetVehicleModel {
  final String id;
  final String plateNumber;
  final String make;
  final String model;
  final String? color;
  final String sector;
  final String category;
  final String status; // 'active', 'on_trip', 'offline', 'registered'
  final String? driverId;
  final String? driverName;
  final String? driverPhone;
  final String state;
  final String city;
  final double? latitude;
  final double? longitude;
  final String? lastLocationAt;
  final String? currentRideId;
  final String verificationStatus;
  final String createdAt;

  const LiveFleetVehicleModel({
    required this.id,
    required this.plateNumber,
    required this.make,
    required this.model,
    this.color,
    required this.sector,
    required this.category,
    required this.status,
    this.driverId,
    this.driverName,
    this.driverPhone,
    required this.state,
    required this.city,
    this.latitude,
    this.longitude,
    this.lastLocationAt,
    this.currentRideId,
    required this.verificationStatus,
    required this.createdAt,
  });

  factory LiveFleetVehicleModel.fromJson(Map<String, dynamic> json) {
    return LiveFleetVehicleModel(
      id: json['id'] as String? ?? '',
      plateNumber: json['plateNumber'] as String? ?? '',
      make: json['make'] as String? ?? '',
      model: json['model'] as String? ?? '',
      color: json['color'] as String?,
      sector: json['sector'] as String? ?? 'passenger',
      category: json['category'] as String? ?? 'sedan',
      status: json['status'] as String? ?? 'offline',
      driverId: json['driverId'] as String?,
      driverName: json['driverName'] as String?,
      driverPhone: json['driverPhone'] as String?,
      state: json['state'] as String? ?? 'Bihar',
      city: json['city'] as String? ?? 'Patna',
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      lastLocationAt: json['lastLocationAt'] as String?,
      currentRideId: json['currentRideId'] as String?,
      verificationStatus: json['verificationStatus'] as String? ?? 'approved',
      createdAt: json['createdAt'] as String? ?? '',
    );
  }
}
