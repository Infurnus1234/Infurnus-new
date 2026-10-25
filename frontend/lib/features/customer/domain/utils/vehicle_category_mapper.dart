/// Helper for normalizing vehicle category codes between the frontend UI
/// and the backend fare estimation and ride booking APIs.
library;

/// Maps UI/catalog vehicle categories to the canonical codes accepted by the backend API.
String normalizeVehicleCategoryForBackend(String sector, String? category) {
  final s = sector.toLowerCase().trim();
  final c = (category ?? '').toLowerCase().trim();

  if (s == 'passenger') {
    switch (c) {
      // Already-valid backend keys — pass through unchanged.
      case 'bike':
        return 'bike';
      case 'auto':
        return 'auto';
      case 'sedan':
        return 'sedan';
      case 'suv':
        return 'suv';
      // UI display aliases → canonical backend codes.
      case 'hatchback':
      case 'mini_cab':
      case 'mini_commercial':
      case 'mini':
        return 'mini';
      case 'innova':
      case 'innova_crysta':
      case 'innova crysta':
      case 'winger':
      case 'traveller':
      case 'force_traveller':
      case 'force traveller':
        return 'suv';
      default:
        return 'mini';
    }
  }

  if (s == 'logistics') {
    switch (c) {
      case 'piaggio_ape':
      case 'piaggio ape':
      case 'ape':
      case 'three_wheeler':
        return 'three_wheeler';
      case 'tata_magic':
      case 'tata magic':
      case 'magic':
      case 'mini_truck':
        return 'mini_truck';
      case 'cargo_207':
      case 'cargo 207':
      case '207 cargo':
      case '207_heavy':
      case 'pickup':
      case 'pickup_8ft':
        return 'pickup_8ft';
      case 'cargo_407':
      case 'cargo 407':
      case '407 cargo':
      case 'tata_407':
      case 'tata 407':
        return 'tata_407';
      case 'ftl':
        return 'ftl';
      default:
        return 'mini_truck';
    }
  }

  if (s == 'service') {
    switch (c) {
      case 'ambulance':
        return 'ambulance';
      case 'towing':
      case 'towing_van':
        return 'towing';
      case 'jcb':
      case 'excavator':
        return 'jcb';
      case 'crane':
      case 'recovery':
      case 'recovery_vehicle':
        return 'recovery';
      default:
        return c.isNotEmpty ? c : 'ambulance';
    }
  }

  if (s == 'premium' || s == 'rental' || s == 'rentals') {
    switch (c) {
      case 'scorpio':
      case 'innova':
      case 'traveller':
      case 'suv':
        return 'suv';
      case 'thar':
        return 'thar';
      case 'sedan':
        return 'sedan';
      case 'fortuner':
        return 'fortuner';
      case 'luxury':
        return 'luxury';
      default:
        return c.isNotEmpty ? c : 'thar';
    }
  }

  return c.isNotEmpty ? c : 'mini';
}

/// Returns the default UI vehicle category for a given sector.
String defaultVehicleCategoryForSector(String sector) {
  switch (sector.toLowerCase().trim()) {
    case 'logistics':
      return 'piaggio_ape';
    case 'service':
      return 'ambulance';
    case 'premium':
    case 'rental':
    case 'rentals':
      return 'scorpio';
    case 'passenger':
    default:
      return 'hatchback';
  }
}
