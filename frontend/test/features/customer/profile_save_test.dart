import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/features/auth/domain/entities/user.dart';
import 'package:infurnus/features/auth/presentation/providers/user_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/profile_screen.dart';

void main() {
  for (final success in [true, false]) {
    testWidgets(
      'Profile save ${success ? 'persists server result' : 'retains edits on failure'}',
      (tester) async {
        tester.view.physicalSize = const Size(900, 1800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final user = User(
          id: 'test-user',
          firstName: 'Before',
          lastName: 'Test',
          role: 'customer',
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );
        final notifier = UserNotifier()..setUser(user);
        final dio = Dio();
        var calls = 0;
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (request, handler) {
              calls++;
              expect(request.method, 'PATCH');
              expect(request.path, '/users/test-user');
              expect(request.data['firstName'], 'Updated');
              if (!success) {
                handler.reject(
                  DioException(
                    requestOptions: request,
                    type: DioExceptionType.badResponse,
                    response: Response(
                      requestOptions: request,
                      statusCode: 503,
                      data: {
                        'error': {'message': 'Profile unavailable'},
                      },
                    ),
                  ),
                );
                return;
              }
              handler.resolve(
                Response(
                  requestOptions: request,
                  statusCode: 200,
                  data: {
                    'success': true,
                    'data': {
                      'id': user.id,
                      'firstName': 'Updated',
                      'lastName': 'Test',
                      'createdAt': '2026-01-01T00:00:00Z',
                      'updatedAt': '2026-10-14T00:00:00Z',
                    },
                  },
                ),
              );
            },
          ),
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              userProvider.overrideWith((ref) => notifier),
              dioProvider.overrideWithValue(dio),
            ],
            child: const MaterialApp(home: ProfileScreen()),
          ),
        );
        await tester.tap(find.text('Personal Information'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Edit'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextField, 'First Name'),
          'Updated',
        );
        await tester.tap(find.text('Save Information'));
        await tester.pumpAndSettle();
        expect(calls, 1);
        expect(notifier.state?.firstName, success ? 'Updated' : 'Before');
        if (success) {
          expect(
            find.text('Personal information updated successfully.'),
            findsOneWidget,
          );
        } else {
          expect(find.text('Profile unavailable'), findsOneWidget);
          expect(find.text('Save Information'), findsOneWidget);
        }
      },
    );
  }
}
