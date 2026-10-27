import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:infurnus/features/auth/presentation/screens/login_screen.dart';
import 'package:infurnus/features/auth/presentation/widgets/auth_phone_field.dart';

class _QuietGoogle extends GoogleSignInPlatform {
  @override
  Future<void> init(InitParameters params) async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  setUpAll(() async {
    final fonts = FontLoader('Roboto')
      ..addFont(
        File('test/fixtures/fonts/roboto-regular.ttf')
            .readAsBytes()
            .then(ByteData.sublistView),
      );
    final icons = FontLoader('MaterialIcons')
      ..addFont(
        File('test/fixtures/fonts/materialicons-regular.otf')
            .readAsBytes()
            .then(ByteData.sublistView),
      );
    final defaultFont = FontLoader('Ahem')
      ..addFont(
        File('test/fixtures/fonts/roboto-regular.ttf')
            .readAsBytes()
            .then(ByteData.sublistView),
      );
    await Future.wait([fonts.load(), icons.load(), defaultFont.load()]);
    GoogleSignInPlatform.instance = _QuietGoogle();
  });

  for (final width in [320.0, 360.0, 393.0, 600.0]) {
    for (final scale in [1.0, 1.5, 2.0]) {
      for (final keyboard in [false, true]) {
        testWidgets('login width=$width text=$scale keyboard=$keyboard', (
          tester,
        ) async {
          tester.view.physicalSize = Size(width, 700);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          FlutterSecureStorage.setMockInitialValues({});
          final key = GlobalKey();
          await tester.pumpWidget(
            ProviderScope(
              child: MaterialApp(
                theme: ThemeData(fontFamily: 'Roboto'),
                home: MediaQuery(
                  data: MediaQueryData(
                    size: Size(width, 700),
                    padding: const EdgeInsets.only(top: 24, bottom: 24),
                    viewInsets: EdgeInsets.only(bottom: keyboard ? 280 : 0),
                    textScaler: TextScaler.linear(scale),
                  ),
                  child: RepaintBoundary(key: key, child: const LoginScreen()),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final phone = find.byType(AuthPhoneField);
          await tester.ensureVisible(phone);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(find.text('+91'), findsOneWidget);
          expect(find.byType(IndiaCallingCode), findsOneWidget);
          final hint = find.text('Enter Phone Number');
          expect(hint, findsOneWidget);
          expect(
            tester.renderObject<RenderParagraph>(hint).didExceedMaxLines,
            isFalse,
          );
          expect(
            tester.widget<TextField>(find.byType(TextField)).keyboardType,
            TextInputType.phone,
          );
          await tester.enterText(find.byType(TextField), '9876543210');
          await tester.pump();
          expect(find.text('9876543210'), findsOneWidget);
          final google = find.text('Sign in with Google');
          await tester.ensureVisible(google);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          if ((width == 393 && scale == 1 && !keyboard) ||
              (width == 320 && scale == 2 && keyboard)) {
            tester
                .widget<TextField>(find.byType(TextField))
                .controller!
                .clear();
            await tester.ensureVisible(phone);
            await tester.pumpAndSettle();
            final boundary =
                key.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary;
            await tester.runAsync(() async {
              final capture = await boundary.toImage();
              final bytes = await capture.toByteData(
                format: ui.ImageByteFormat.png,
              );
              final out = Directory(
                '../artifacts/customer-login-layout-20261026',
              )..createSync(recursive: true);
              await File(
                '${out.path}/login-${width.toInt()}-text-$scale-keyboard-$keyboard.png',
              ).writeAsBytes(bytes!.buffer.asUint8List());
            });
          }
          await tester.pumpWidget(const SizedBox());
        });
      }
    }
  }
}
