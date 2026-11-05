import '../../domain/utils/passenger_catalog.dart';
import '../../domain/utils/logistics_catalog.dart';
import '../../data/models/fleet_vehicle_model.dart';
import '../../domain/utils/vehicle_visibility.dart';
import '../../../../shared/widgets/vehicle_visual_image.dart';

List<Map<String, String>> customerVehiclePresentation(
  String sector,
  List<FleetVehicleModel> fleet,
) {
  if (sector == 'logistics') return logisticsVehicles;
  if (sector == 'passenger' || sector == 'rental') return passengerVehicles;
  final result = <Map<String, String>>[];
  for (final vehicle in fleet) {
    if (!isCustomerVehicleVisible(
          sector,
          vehicle.category,
          vehicle.displayName,
        ) ||
        result.any((item) => item['category'] == vehicle.category)) {
      continue;
    }
    result.add({
      'category': vehicle.category,
      'name': vehicle.displayName,
      'capacity': 'Select pickup',
      'image':
          VehicleVisualImage.getAssetPath(
            vehicle.displayName,
            vehicle.category,
          ) ??
          '',
    });
  }
  return result;
}

const premiumVehicleImages = {
  'scorpio': 'assets/images/premium_scorpio_n_black.png',
  'mercedes': 'assets/images/premium_mercedes_v_class_black.png',
  'helicopter': 'assets/images/premium_helicopter.png',
};
