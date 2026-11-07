import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/presentation/widgets/ride_contact_action.dart';

void main() {
  for (final entry in {
    'rental': '11',
    'service': '22',
    'premium': '33',
    'logistics': '44',
  }.entries) {
    RideModel booking({String? callingNumber = '+919153787859'}) =>
        RideModel.fromJson({
          'id': '11111111-1111-4111-8111-111111111111',
          'customerId': 'customer',
          'assignedDriverId': 'driver',
          'bookingId': '${entry.value}00382',
          'callingNumber': callingNumber,
          'sector': entry.key,
          'status': 'driver_assigned',
          'pickup': {'latitude': 25.6, 'longitude': 85.1},
          'destination': {'latitude': 26.1, 'longitude': 85.3},
          'driverDetails': {
            'id': 'driver',
            'name': 'Audit Driver',
            'phone': '+919876543210',
          },
          'createdAt': '2026-11-07T00:00:00Z',
          'updatedAt': '2026-11-07T00:00:00Z',
        });
    test(
      '${entry.key}: calls official number and discards legacy peer number',
      () async {
        final ride = booking();
        Uri? launched;
        expect(ride.driverDetails?.phone, isNull);
        expect(ride.bookingId, '${entry.value}00382');
        expect(
          await launchAssignedRideContact(
            ride,
            launcher: (uri) async {
              launched = uri;
              return true;
            },
          ),
          isTrue,
        );
        expect(launched.toString(), 'tel:+919153787859');
        if (entry.key == 'service') {
          expect(
            assignedRideContactUri(ride, serviceOnly: true)?.path,
            '+919153787859',
          );
        }
        expect(assignedRideContactUri(booking(callingNumber: null)), isNull);
      },
    );
  }
}
