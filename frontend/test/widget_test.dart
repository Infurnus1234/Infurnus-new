import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/app/app.dart';

void main() {
  testWidgets('Infurnus app loads successfully', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: InfurnusApp(),
      ),
    );

    expect(find.byType(InfurnusApp), findsOneWidget);
  });
}
