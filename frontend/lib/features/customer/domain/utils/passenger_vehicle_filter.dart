/// Utility for filtering unsupported passenger vehicles (Bike, Auto, E-Rickshaw).
///
/// Bike, Auto, and E-Rickshaw are excluded from passenger ride booking.
/// Cargo vehicles (in logistics), emergency vehicles, and rental vehicles
/// are separate and unaffected.
bool isExcludedPassengerVehicle(String? category, [String? name]) {
  final cat = (category ?? '').toLowerCase().trim();
  final n = (name ?? '').toLowerCase().trim();

  if (cat.isEmpty && n.isEmpty) return false;

  const excludedSlugs = {
    'bike',
    'motorcycle',
    'two_wheeler',
    'two-wheeler',
    'auto',
    'auto_rickshaw',
    'autorickshaw',
    'rickshaw',
    'e_rickshaw',
    'erickshaw',
    'e-rickshaw',
    'personal_e_rickshaw',
    'personal e rickshaw',
    'electric_rickshaw',
    'tuk_tuk',
    'tuk-tuk',
    'tuktuk',
  };

  if (excludedSlugs.contains(cat) || excludedSlugs.contains(n)) {
    return true;
  }

  if (cat == 'bike' ||
      cat.contains('motorcycle') ||
      cat.contains('two_wheeler') ||
      cat.contains('two-wheeler')) {
    return true;
  }
  if (cat == 'auto' ||
      cat.contains('autorickshaw') ||
      cat.contains('auto_rickshaw')) {
    return true;
  }
  if (cat.contains('rickshaw') || cat.contains('tuk')) {
    return true;
  }

  if (n == 'bike' ||
      n.contains('motorcycle') ||
      n.contains('two-wheeler') ||
      n.contains('two wheeler')) {
    return true;
  }
  if (n == 'auto' ||
      n.contains('auto rickshaw') ||
      n.contains('autorickshaw') ||
      n.contains('auto-rickshaw')) {
    return true;
  }
  if (n.contains('rickshaw') || n.contains('tuk')) {
    return true;
  }

  return false;
}
