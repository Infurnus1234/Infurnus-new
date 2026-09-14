class Ride {
  final String id;
  final String pickupAddress;
  final String destinationAddress;
  final double fare;
  final String status; // INITIAL, SEARCHING, MATCHED, ACTIVE, COMPLETED
  final String? driverName;
  final String? vehicleNumber;

  Ride({
    required this.id,
    required this.pickupAddress,
    required this.destinationAddress,
    required this.fare,
    required this.status,
    this.driverName,
    this.vehicleNumber,
  });

  factory Ride.fromJson(Map<String, dynamic> json) {
    return Ride(
      id: json['id'],
      pickupAddress: json['pickupAddress'],
      destinationAddress: json['destinationAddress'],
      fare: json['fare'].toDouble(),
      status: json['status'],
      driverName: json['driverName'],
      vehicleNumber: json['vehicleNumber'],
    );
  }
}
