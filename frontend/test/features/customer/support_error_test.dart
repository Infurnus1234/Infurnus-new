import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/errors/support_error_message.dart';
import 'package:infurnus/features/driver/data/datasources/driver_remote_data_source.dart';
import 'package:infurnus/features/driver/data/models/support_ticket_model.dart';
import 'package:infurnus/features/driver/presentation/providers/driver_providers.dart';
import 'package:infurnus/features/driver/presentation/screens/support_tickets_screen.dart';

DioException rejection(int status, {Map<String, dynamic>? body}) {
  final request = RequestOptions(path: '/support/tickets');
  return DioException.badResponse(
    statusCode: status,
    requestOptions: request,
    response: Response(requestOptions: request, statusCode: status, data: body),
  );
}

class RejectedSupportSource implements DriverRemoteDataSource {
  bool failList = true;
  Map<String, dynamic>? submitted;
  @override
  Future<List<SupportTicketModel>> listSupportTickets({int page = 1}) async {
    if (failList) {
      throw rejection(
        400,
        body: {
          'error': {'message': 'Page must be at least 1.'},
        },
      );
    }
    return [];
  }

  @override
  Future<SupportTicketModel> createSupportTicket(
    Map<String, dynamic> data,
  ) async {
    submitted = data;
    throw rejection(
      400,
      body: {
        'error': {
          'message': 'Request validation failed',
          'details': [
            {
              'field': 'message',
              'message': 'Message must be at least 5 characters.',
            },
          ],
        },
      },
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('error presentation preserves failure status and never displays Dio internals', () {
    for (final status in [400, 401, 403, 404, 500]) {
      final error = rejection(status);
      expect(supportErrorMessage(error), isNot(contains('DioException')));
      expect(error.response?.statusCode, status);
    }
    expect(
      supportErrorMessage(rejection(400, body: {'error': 'invalid'})),
      contains('rejected'),
    );
  });

  testWidgets(
    'list and create failures show validation messages and retain the draft',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final source = RejectedSupportSource();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [driverRemoteDataSourceProvider.overrideWithValue(source)],
          child: const MaterialApp(home: SupportTicketsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Page must be at least 1.'), findsOneWidget);
      expect(find.textContaining('DioException'), findsNothing);
      source.failList = false;
      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New Ticket'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'Booking problem',
      );
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'Please investigate this issue.',
      );
      await tester.tap(find.text('Submit Ticket'));
      await tester.pumpAndSettle();
      expect(
        find.text('Message must be at least 5 characters.'),
        findsOneWidget,
      );
      expect(find.textContaining('DioException'), findsNothing);
      expect(find.text('Please investigate this issue.'), findsOneWidget);
      expect(
        source.submitted?['requestId'],
        matches(RegExp(r'^[a-f0-9]{32}$')),
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
}
