import '../../../customer/data/models/ride_model.dart';

class DriverHistoryModel {
  final int totalTrips;
  final double totalEarnings;
  final List<RideModel> rides;

  DriverHistoryModel({
    required this.totalTrips,
    required this.totalEarnings,
    required this.rides,
  });

  factory DriverHistoryModel.fromJson(Map<String, dynamic> json) {
    final ridesList = (json['rides'] as List?) ?? [];
    return DriverHistoryModel(
      totalTrips: (json['totalTrips'] as num?)?.toInt() ?? 0,
      totalEarnings: (json['totalEarnings'] as num?)?.toDouble() ?? 0.0,
      rides: ridesList.map((e) => RideModel.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}
