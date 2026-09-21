class FleetDashboardModel {
  final int totalVehicles;
  final int activeVehicles;
  final int availableVehicles;
  final int maintenanceVehicles;
  final int totalDrivers;
  final int availableDrivers;
  final int pendingDocuments;
  final int activeTrips;
  final double todayRevenue;

  FleetDashboardModel({
    required this.totalVehicles,
    required this.activeVehicles,
    required this.availableVehicles,
    required this.maintenanceVehicles,
    required this.totalDrivers,
    required this.availableDrivers,
    required this.pendingDocuments,
    required this.activeTrips,
    required this.todayRevenue,
  });

  factory FleetDashboardModel.fromJson(Map<String, dynamic> json) {
    return FleetDashboardModel(
      totalVehicles: json['totalVehicles'] as int? ?? 0,
      activeVehicles: json['activeVehicles'] as int? ?? 0,
      availableVehicles: json['availableVehicles'] as int? ?? 0,
      maintenanceVehicles: json['maintenanceVehicles'] as int? ?? 0,
      totalDrivers: json['totalDrivers'] as int? ?? 0,
      availableDrivers: json['availableDrivers'] as int? ?? 0,
      pendingDocuments: json['pendingDocuments'] as int? ?? 0,
      activeTrips: json['activeTrips'] as int? ?? 0,
      todayRevenue: (json['todayRevenue'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
