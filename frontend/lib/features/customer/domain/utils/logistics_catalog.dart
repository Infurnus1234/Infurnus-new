/// Ordered customer catalog. Category codes are used by the existing fare API.
const logisticsVehicles = <Map<String, String>>[
  {
    'category': 'piaggio_ape',
    'filter': '3-Wheeler',
    'subtitle': 'City delivery',
    'name': 'Piaggio Ape',
    'image': 'assets/images/piaggio_ape_yellow.png',
  },
  {
    'category': 'tata_magic',
    'filter': 'Mini Truck',
    'subtitle': 'Goods transport',
    'name': 'Tata Magic',
    'image': 'assets/images/tata_magic_cream.png',
  },
  {
    'category': 'cargo_207',
    'filter': 'Mini Truck',
    'subtitle': 'Medium cargo',
    'name': 'Tata 207',
    'image': 'assets/images/cargo_207_heavy.png',
  },
  {
    'category': 'tata_407',
    'filter': 'Truck',
    'subtitle': 'Heavy cargo',
    'name': 'Tata 407',
    'image': 'assets/images/logistics_tata_407.webp',
  },
];

String? logisticsVehicleName(String? category) {
  for (final vehicle in logisticsVehicles) {
    if (vehicle['category'] == category ||
        (category == 'cargo_407' && vehicle['category'] == 'tata_407')) {
      return vehicle['name'];
    }
  }
  return null;
}
