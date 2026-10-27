import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/auth/presentation/utils/phone_number.dart';

void main() {
  test('national and country-prefixed numbers resolve to one identity', () {
    for (final input in ['9876543210', '919876543210', '+91 98765-43210']) {
      expect(normalizeAuthPhone(input), '+919876543210');
    }
    expect(normalizeAuthPhone('+44 7700 900123'), '+447700900123');
  });
  test('malformed numbers fail before creating an OTP challenge', () {
    for (final input in [
      '',
      '12345',
      '9876543210123',
      '++919876543210',
      'hello9876543210',
      '+0123456789',
      '1234567890',
    ]) {
      expect(normalizeAuthPhone(input), isNull, reason: input);
    }
  });
}
