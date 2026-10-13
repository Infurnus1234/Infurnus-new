import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/driver/data/datasources/driver_remote_data_source.dart';
import 'package:infurnus/features/driver/data/models/support_ticket_model.dart';
import 'package:infurnus/features/driver/presentation/providers/driver_providers.dart';
import 'package:infurnus/features/driver/presentation/screens/support_tickets_screen.dart';

class CreationSource implements DriverRemoteDataSource {
  final tickets = <SupportTicketModel>[];
  @override
  Future<List<SupportTicketModel>> listSupportTickets({int page = 1}) async =>
      tickets.toList();
  @override
  Future<SupportTicketModel> createSupportTicket(
    Map<String, dynamic> data,
  ) async {
    final ticket = SupportTicketModel(
      id: '${tickets.length}',
      ticketNumber: 'TEST-${tickets.length}',
      userId: 'test',
      role: 'customer',
      category: data['category'],
      subject: data['subject'],
      message: data['message'],
      status: 'OPEN',
    );
    tickets.add(ticket);
    return ticket;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Unused test operation');
}

void main() {
  testWidgets('Customer can submit another ticket after successful creation', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final source = CreationSource();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [driverRemoteDataSourceProvider.overrideWithValue(source)],
        child: const MaterialApp(home: SupportTicketsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    for (var i = 0; i < 2; i++) {
      await tester.tap(find.text('New Ticket'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'TEST_SAMPLE issue $i',
      );
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'TEST_SAMPLE description',
      );
      await tester.tap(find.text('Submit Ticket'));
      await tester.pumpAndSettle();
      expect(source.tickets.length, i + 1);
    }
  });
}
