import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/models/ride_model.dart' as model;
import '../providers/ride_provider.dart';
import '../providers/ride_repository_provider.dart';

Uri? assignedRideContactUri(model.RideModel? ride, {bool serviceOnly = false}) {
  if (ride == null ||
      (serviceOnly && ride.sector != 'service') ||
      ride.assignedDriverId == null ||
      !const [
        model.RideStatus.driverAssigned,
        model.RideStatus.driverArriving,
        model.RideStatus.driverArrived,
        model.RideStatus.inProgress,
      ].contains(ride.status)) {
    return null;
  }
  final raw = ride.callingNumber?.trim();
  if (raw == null || raw.isEmpty || !RegExp(r'^\+?[0-9 ()-]+$').hasMatch(raw)) {
    return null;
  }
  final phone = raw.replaceAll(RegExp(r'[ ()-]'), '');
  if (!RegExp(r'^\+?[1-9]\d{7,14}$').hasMatch(phone)) return null;
  return Uri(scheme: 'tel', path: phone);
}

Future<bool> launchAssignedRideContact(
  model.RideModel ride, {
  bool serviceOnly = false,
  Future<bool> Function(Uri)? launcher,
}) async {
  final uri = assignedRideContactUri(ride, serviceOnly: serviceOnly);
  if (uri == null) return false;
  // Opens the system dialer; the customer decides whether to place the call.
  return (launcher ??
      (uri) => launchUrl(uri, mode: LaunchMode.externalApplication))(uri);
}

Future<void> callAssignedRideContact(
  BuildContext context,
  WidgetRef ref, {
  bool serviceOnly = false,
}) async {
  void message(String text) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  final current = ref.read(rideProvider).currentRide;
  if (current == null || (serviceOnly && current.sector != 'service')) {
    message(
      'A provider must be assigned to an active booking before you can call.',
    );
    return;
  }
  try {
    // Revalidate assignment/contact with the existing authenticated ride API.
    final fresh = await ref.read(rideRepositoryProvider).getRide(current.id);
    if (!context.mounted) return;
    final active = ref.read(rideProvider).currentRide;
    if (active?.id != current.id ||
        const [
          model.RideStatus.cancelled,
          model.RideStatus.completed,
        ].contains(active?.status)) {
      return;
    }
    if (assignedRideContactUri(fresh, serviceOnly: serviceOnly) == null) {
      message(
        'The assigned provider’s contact number is unavailable for this booking.',
      );
      return;
    }
    if (!await launchAssignedRideContact(fresh, serviceOnly: serviceOnly)) {
      message('Unable to open the phone dialer on this device.');
    }
  } catch (_) {
    message('Contact details could not be verified. Please try again.');
  }
}
