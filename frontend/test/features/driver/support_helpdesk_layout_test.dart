import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/driver/data/datasources/driver_remote_data_source.dart';
import 'package:infurnus/features/driver/data/models/support_ticket_model.dart';
import 'package:infurnus/features/driver/presentation/providers/driver_providers.dart';
import 'package:infurnus/features/driver/presentation/screens/support_tickets_screen.dart';

class _EmptySupportSource implements DriverRemoteDataSource {
  @override
  Future<List<SupportTicketModel>> listSupportTickets({int page = 1}) async =>
      [];

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Unused');
}

void main() {
  testWidgets(
    'UA-02: Support tickets screen renders compact top contact and grouped empty state at 360px and large text scale',
    (tester) async {
      // Set 360px mobile width with 2.0 text scale
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            driverRemoteDataSourceProvider.overrideWithValue(
              _EmptySupportSource(),
            ),
          ],
          child: MaterialApp(
            theme: ThemeData.dark(),
            home: const MediaQuery(
              data: MediaQueryData(
                size: Size(360, 800),
                textScaler: TextScaler.linear(1.5),
              ),
              child: SupportTicketsScreen(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Verify compact email card at the top
      expect(find.text('Email Driver Support'), findsOneWidget);
      expect(find.text('support@infurnuslogistics.com'), findsOneWidget);

      // Verify empty state title and grouped New Ticket action
      expect(find.text('No Support Tickets'), findsOneWidget);
      expect(find.text('New Ticket'), findsOneWidget);

      // Verify pagination is not scattered on empty state
      expect(find.text('Previous'), findsNothing);
      expect(find.text('Next'), findsNothing);

      // Verify no layout exceptions / overflow
      expect(tester.takeException(), isNull);
    },
  );
}
