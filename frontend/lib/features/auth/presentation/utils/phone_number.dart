/// Accept an Indian national number or an explicit international E.164 number.
/// Do not silently strip arbitrary letters or prepend India's code twice.
String? normalizeAuthPhone(String input) {
  final raw = input.trim();
  if (!RegExp(r'^[+\d\s().-]+$').hasMatch(raw)) return null;
  final compact = raw.replaceAll(RegExp(r'[\s().-]'), '');
  if (compact.startsWith('+')) {
    return RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(compact) ? compact : null;
  }
  if (RegExp(r'^91[6-9]\d{9}$').hasMatch(compact)) return '+$compact';
  if (RegExp(r'^[6-9]\d{9}$').hasMatch(compact)) return '+91$compact';
  return null;
}
