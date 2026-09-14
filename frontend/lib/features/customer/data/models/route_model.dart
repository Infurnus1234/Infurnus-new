class RouteModel {
  final double distanceMeters;
  final int durationSeconds;
  final String? encodedPolyline;

  const RouteModel({
    required this.distanceMeters,
    required this.durationSeconds,
    this.encodedPolyline,
  });

  factory RouteModel.fromJson(Map<String, dynamic> json) {
    return RouteModel(
      distanceMeters: (json['distanceMeters'] as num).toDouble(),
      durationSeconds: (json['durationSeconds'] as num).toInt(),
      encodedPolyline: json['encodedPolyline'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'distanceMeters': distanceMeters,
        'durationSeconds': durationSeconds,
        if (encodedPolyline != null) 'encodedPolyline': encodedPolyline,
      };
}
