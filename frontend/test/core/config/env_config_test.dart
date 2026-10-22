import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/config/env_config.dart';

void main() {
  test('fresh checkout defaults to hosted API, never developer LAN', () {
    expect(EnvConfig.active.baseUrl, EnvConfig.prod.baseUrl);
    expect(Uri.parse(EnvConfig.active.baseUrl).scheme, 'https');
  });
  test('Android emulator uses host bridge', () {
    expect(EnvConfig.emulator.baseUrl, 'http://10.0.2.2:3000');
  });
}
