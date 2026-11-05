/// Visibility follows authoritative ride state, never GPS displacement.
bool rideHasStarted(String? status) {
  final normalized = status
      ?.toLowerCase()
      .replaceAll('_', '')
      .replaceAll('-', '');
  return const {
    'active',
    'inprogress',
    'ridestarted',
    'rideinprogress',
    'completed',
  }.contains(normalized);
}
