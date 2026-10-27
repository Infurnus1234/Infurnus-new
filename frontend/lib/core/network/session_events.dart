import 'package:flutter_riverpod/flutter_riverpod.dart';

// Transport publishes definitive rejection without depending on auth/UI providers.
final sessionRejectionProvider = StateProvider<int>((ref) => 0);
