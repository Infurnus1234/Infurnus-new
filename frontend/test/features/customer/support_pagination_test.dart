import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/driver/data/datasources/driver_remote_data_source.dart';
import 'package:infurnus/features/driver/data/models/support_ticket_model.dart';
import 'package:infurnus/features/driver/presentation/providers/driver_providers.dart';
import 'package:infurnus/features/driver/presentation/screens/support_tickets_screen.dart';

class TestSupportSource implements DriverRemoteDataSource {
  final pages = <int>[];
  @override
  Future<List<SupportTicketModel>> listSupportTickets({int page = 1}) async {
    pages.add(page);
    return List.generate(
      page == 1 ? 25 : 1,
      (i) => SupportTicketModel(
        id: '$page-$i',
        ticketNumber: 'TEST-$page-$i',
        userId: 'test',
        role: 'customer',
        category: 'App',
        subject: 'Page $page issue $i',
        message: 'TEST_SAMPLE',
        status: 'OPEN',
      ),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Unused fixture operation');
}

void main() {
  testWidgets('customer ticket page controls fetch the correct backend page', (
    tester,
  ) async {
    final source = TestSupportSource();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [driverRemoteDataSourceProvider.overrideWithValue(source)],
        child: const MaterialApp(home: SupportTicketsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(source.pages, [1]);
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(source.pages, [1, 2]);
    expect(find.text('Page 2 issue 0'), findsOneWidget);
    await tester.tap(find.text('Previous'));
    await tester.pumpAndSettle();
    expect(source.pages, [1, 2, 1]);
  });
}
