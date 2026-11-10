import 'package:intl/intl.dart';

import '../../data/models/fleet_vehicle_model.dart';
import '../../domain/utils/vehicle_visibility.dart';
import '../../../../shared/widgets/vehicle_visual_image.dart';

List<Map<String, String>> customerVehiclePresentation(
  String sector,
  List<FleetVehicleModel> fleet,
) {
  final result = <Map<String, String>>[];
  for (final vehicle in fleet) {
    if (vehicle.sector != sector ||
        !vehicle.catalogVisible ||
        !isCustomerVehicleVisible(
          sector,
          vehicle.category,
          vehicle.displayName,
        ) ||
        result.any((item) => item['category'] == vehicle.category)) {
      continue;
    }
    final metadata =
        vehicleDisplayMetadata[sector == 'rental'
            ? 'passenger'
            : sector]?[vehicle.category];
    final loadCapacity = sector == 'logistics' && vehicle.loadCapacityKg > 0
        ? 'Up to ${NumberFormat.decimalPattern('en_IN').format(vehicle.loadCapacityKg)} kg'
        : null;
    final description = metadata?['subtitle'];
    final subtitle = [
      if (loadCapacity != null) loadCapacity,
      if (description != null) description,
    ].join(' • ');
    result.add({
      'category': vehicle.category,
      'name': vehicle.displayName,
      'capacity':
          loadCapacity ??
          metadata?['capacity'] ??
          description ??
          'Select pickup',
      'subtitle': subtitle.isEmpty ? 'Select pickup' : subtitle,
      'filter': metadata?['filter'] ?? 'Other',
      'filterCategory': metadata?['filterCategory'] ?? 'Luxury',
      'service': metadata?['service'] ?? 'Chauffeur + Fuel',
      'image':
          (sector == 'premium'
              ? premiumVehicleImages[vehicle.category]
              : null) ??
          metadata?['image'] ??
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

// Presentation metadata never determines which backend options are selectable.
const vehicleDisplayMetadata = <String, Map<String, Map<String, String>>>{
  "logistics": {
    "piaggio_ape": {
      "filter": "3-Wheeler",
      "subtitle": "City delivery",
      "name": "Piaggio Ape",
      "image": "assets/images/piaggio_ape_yellow.png",
    },
    "tata_magic": {
      "filter": "Mini Truck",
      "subtitle": "Goods transport",
      "name": "Tata Magic",
      "image": "assets/images/tata_magic_cream.png",
    },
    "cargo_207": {
      "filter": "Mini Truck",
      "subtitle": "Medium cargo",
      "name": "Tata 207",
      "image": "assets/images/cargo_207_heavy.png",
    },
    "tata_407": {
      "filter": "Truck",
      "subtitle": "Heavy cargo",
      "name": "Tata 407",
      "image": "assets/images/logistics_tata_407.webp",
    },
  },
  "passenger": {
    "hatchback": {
      "name": "Hatchback",
      "capacity": "4 seater",
      "image": "assets/images/rental_hatchback.webp",
    },
    "sedan": {
      "name": "Sedan",
      "capacity": "4 seater",
      "image": "assets/images/sedan_clean.jpg",
    },
    "innova": {
      "name": "Innova Crysta",
      "capacity": "6-7 seater",
      "image": "assets/images/innova_crysta_clean.jpg",
    },
    "mini": {
      "name": "Mini Cab",
      "capacity": "4 seater",
      "image": "assets/images/hatchback_clean.jpg",
    },
  },
  "premium": {
    "scorpio": {
      "title": "Scorpio N",
      "subtitle": "Rugged SUV",
      "service": "Chauffeur + Fuel",
      "filterCategory": "SUV",
    },
    "thar": {
      "title": "Mahindra Thar",
      "subtitle": "Off-road",
      "service": "Chauffeur + Fuel",
      "filterCategory": "Off-road",
    },
    "innova": {
      "title": "Innova Crysta",
      "subtitle": "Executive",
      "service": "Chauffeur + Fuel",
      "filterCategory": "Luxury",
    },
    "traveller": {
      "title": "Force Traveller",
      "subtitle": "12 seater",
      "service": "Chauffeur + Fuel",
      "filterCategory": "Vans",
    },
    "mercedes": {
      "title": "Mercedes V-Class",
      "subtitle": "Luxury Van",
      "service": "Chauffeur + Fuel",
      "filterCategory": "Luxury",
    },
    "helicopter": {
      "title": "Helicopter",
      "subtitle": "On-demand",
      "service": "Chauffeur + Pilot",
      "filterCategory": "Luxury",
    },
  },
  "service": {
    "crane": {
      "title": "Crane",
      "filter": "Construction",
      "subtitle": "Heavy lifting assistance",
      "image": "assets/images/crane_truck.png",
    },
    "ambulance": {
      "title": "Ambulance",
      "filter": "Emergency",
      "subtitle": "Patient + Medical Triage",
      "image": "assets/images/ambulance_clean.jpg",
    },
    "towing": {
      "title": "Towing Van",
      "filter": "Emergency",
      "subtitle": "Breakdown Assistance",
      "image": "assets/images/flatbed_towing_truck.png",
    },
    "jcb": {
      "title": "JCB",
      "filter": "Construction",
      "subtitle": "Excavation Assistance",
      "image": "assets/images/jcb_excavator.jpg",
    },
  },
};
