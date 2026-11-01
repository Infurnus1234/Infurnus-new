/// Helper for normalizing vehicle category codes between the frontend UI
/// and the backend fare estimation and ride booking APIs.
library;

/// Maps UI/catalog vehicle categories to the canonical codes accepted by the backend API.
String normalizeVehicleCategoryForBackend(String sector, String? category) {
  final s = sector.toLowerCase().trim();
  final c = (category ?? '').toLowerCase().trim();

  const labels = {
    'innova crysta': 'innova',
    'innova_crysta': 'innova',
    'force traveller': 'traveller',
    'force_traveller': 'traveller',
    'piaggio ape': 'piaggio_ape',
    'tata magic': 'tata_magic',
    '207 cargo': 'cargo_207',
    '407 cargo': 'cargo_407',
    'towing van': 'towing',
    'towing_van': 'towing',
    'jcb / excavator': 'jcb',
    'roadside assist': 'roadside_assist',
    'toyota fortuner': 'fortuner',
    'mahindra thar': 'thar',
  };
  if (c == 'scorpio n') return s == 'rental' ? 'scorpio_n' : 'scorpio';
  // Only labels for the same vehicle may normalize. Unknown codes reach the
  // backend unchanged and fail closed; no other vehicle's price is substituted.
  return labels[c] ?? c;
}

/// Returns the default UI vehicle category for a given sector.
String defaultVehicleCategoryForSector(String sector) {
  switch (sector.toLowerCase().trim()) {
    case 'logistics':
      return 'piaggio_ape';
    case 'service':
      return 'ambulance';
    case 'premium':
      return 'scorpio';
    case 'rental':
    case 'rentals':
      return 'innova';
    case 'passenger':
    default:
      return 'hatchback';
  }
}
