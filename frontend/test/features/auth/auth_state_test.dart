import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_provider.dart';

void main() {
  test('login clears a previous signup and previous error', () {
    final state = AuthState(
      status: AuthStatus.otpRequired,
      signupId: 'old',
      errorMessage: 'Invalid OTP',
    );
    final next = state.copyWith(signupId: null, errorMessage: null);
    expect(next.signupId, isNull);
    expect(next.errorMessage, isNull);
  });
}
