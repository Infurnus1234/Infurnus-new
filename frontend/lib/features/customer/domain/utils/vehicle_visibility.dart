import 'logistics_catalog.dart';
import 'passenger_catalog.dart';

/// Customer-facing selection only; backend records and past rides are untouched.
bool isCustomerVehicleVisible(String sector, String code, [String? name]) {
  final category = code.toLowerCase().trim();
  if (sector == 'service') {
    return {'ambulance', 'towing', 'jcb'}.contains(category);
  }
  if (sector == 'passenger' || sector == 'rental') {
    return passengerVehicles.any((vehicle) => vehicle['category'] == category);
  }
  if (sector == 'logistics') {
    return logisticsVehicles.any((vehicle) => vehicle['category'] == category);
  }
  return true;
}
