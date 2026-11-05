/// Ordered customer catalog. Category codes are used by the existing fare API.
const logisticsVehicles = <Map<String, String>>[
  {
    'category': 'piaggio_ape',
    'filter': '3-Wheeler',
    'subtitle': 'Up to 700 kg • City delivery',
    'name': 'Piaggio Ape',
    'capacity': 'Up to 500 kg',
    'image': 'assets/images/piaggio_ape_yellow.png',
  },
  {
    'category': 'tata_magic',
    'filter': 'Mini Truck',
    'subtitle': 'Up to 1700 kg • Goods transport',
    'name': 'Tata Magic',
    'capacity': 'Up to 750 kg',
    'image': 'assets/images/tata_magic_cream.png',
  },
  {
    'category': 'cargo_207',
    'filter': 'Mini Truck',
    'subtitle': 'Up to 2500 kg • Medium cargo',
    'name': 'Tata 207',
    'capacity': 'Up to 1500 kg',
    'image': 'assets/images/cargo_207_heavy.png',
  },
  {
    'category': 'tata_407',
    'filter': 'Truck',
    'subtitle': 'Up to 4000 kg • Heavy cargo',
    'name': 'Tata 407',
    'capacity': 'Up to 2500 kg',
    'image': 'assets/images/cargo_407.jpg',
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
