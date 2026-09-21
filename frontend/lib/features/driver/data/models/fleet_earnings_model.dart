class FleetEarningsModel {
  final double todayRevenue;
  final double thisWeekRevenue;
  final double thisMonthRevenue;
  final int totalTrips;
  final double platformCommission;
  final double netPayout;

  FleetEarningsModel({
    required this.todayRevenue,
    required this.thisWeekRevenue,
    required this.thisMonthRevenue,
    required this.totalTrips,
    required this.platformCommission,
    required this.netPayout,
  });

  factory FleetEarningsModel.fromJson(Map<String, dynamic> json) {
    return FleetEarningsModel(
      todayRevenue: (json['todayRevenue'] as num?)?.toDouble() ?? 0.0,
      thisWeekRevenue: (json['thisWeekRevenue'] as num?)?.toDouble() ?? 0.0,
      thisMonthRevenue: (json['thisMonthRevenue'] as num?)?.toDouble() ?? 0.0,
      totalTrips: json['totalTrips'] as int? ?? 0,
      platformCommission: (json['platformCommission'] as num?)?.toDouble() ?? 0.0,
      netPayout: (json['netPayout'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
