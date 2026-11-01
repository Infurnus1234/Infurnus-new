import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/driver/data/datasources/driver_remote_data_source.dart';
import 'package:infurnus/features/driver/data/models/support_ticket_model.dart';
import 'package:infurnus/features/driver/presentation/providers/driver_providers.dart';
import 'package:infurnus/features/driver/presentation/screens/support_tickets_screen.dart';

class RefreshSource implements DriverRemoteDataSource {
  String status = 'OPEN';
  SupportTicketModel get ticket => SupportTicketModel(
    id: 'ticket',
    ticketNumber: 'INF-SUP-000001',
    userId: 'owner',
    role: 'customer',
    category: 'App',
    subject: 'Booking issue',
    message: 'Complete issue description',
    status: status,
  );
  @override
  Future<List<SupportTicketModel>> listSupportTickets({int page = 1}) async => [
    ticket,
  ];
  @override
  Future<SupportTicketModel> getSupportTicket(String id) async => ticket;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'customer ticket list and open detail reflect refreshed server statuses',
    (tester) async {
      final source = RefreshSource();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [driverRemoteDataSourceProvider.overrideWithValue(source)],
          child: const MaterialApp(home: SupportTicketsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('OPEN'), findsOneWidget);
      source.status = 'RESOLVED';
      await tester.pump(const Duration(seconds: 10));
      await tester.pumpAndSettle();
      expect(find.text('RESOLVED'), findsOneWidget);
      await tester.tap(find.text('INF-SUP-000001'));
      await tester.pumpAndSettle();
      expect(find.text('Status: RESOLVED'), findsOneWidget);
      source.status = 'CLOSED';
      await tester.pump(const Duration(seconds: 10));
      await tester.pumpAndSettle();
      expect(find.text('Status: CLOSED'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
