/// Only validates the shape of a selection. The backend owns catalog eligibility.
/// JCB and Crane are excluded from all customer-facing catalogs and lists.
bool isCustomerVehicleVisible(String sector, String code, [String? name]) {
  if (!const {
    'passenger',
    'rental',
    'logistics',
    'premium',
    'service',
  }.contains(sector)) {
    return false;
  }
  if (code.trim().isEmpty) return false;
  final normalizedCode = code.toLowerCase().trim();
  final normalizedName = (name ?? '').toLowerCase().trim();
  if (normalizedCode == 'jcb' ||
      normalizedCode == 'crane' ||
      normalizedName.contains('jcb') ||
      normalizedName.contains('crane')) {
    return false;
  }
  return true;
}
