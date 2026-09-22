import 'package:flutter/foundation.dart';

enum Environment { dev, staging, prod, emulator }

class EnvConfig {
  final String baseUrl;
  final String socketUrl;
  final Environment environment;

  const EnvConfig({
    required this.baseUrl,
    required this.socketUrl,
    required this.environment,
  });

  // Dynamic configuration via compile-time environment flags:
  // flutter run --dart-define=API_URL=https://api.infurnus.com
  // flutter build apk --release --dart-define=ENVIRONMENT=prod
  static const String _definedApiUrl = String.fromEnvironment('API_URL');
  static const String _definedSocketUrl = String.fromEnvironment('SOCKET_URL');
  static const String _definedEnv = String.fromEnvironment('ENVIRONMENT', defaultValue: '');

  static EnvConfig get active {
    // 1. Production defaults in release mode when no explicit dev/staging flag is passed
    if (_definedEnv == 'prod' || (kReleaseMode && _definedEnv.isEmpty && _definedApiUrl.isEmpty)) {
      return prod;
    }
    if (_definedEnv == 'staging') {
      return staging;
    }
    if (_definedEnv == 'emulator') {
      return emulator;
    }

    // 2. Dynamic override if API_URL is supplied
    if (_definedApiUrl.isNotEmpty) {
      final socket = _definedSocketUrl.isNotEmpty ? _definedSocketUrl : _definedApiUrl;
      return EnvConfig(
        baseUrl: _definedApiUrl,
        socketUrl: socket,
        environment: kReleaseMode ? Environment.prod : Environment.dev,
      );
    }

    // 3. Local development default (Android emulator loopback 10.0.2.2:3000)
    return dev;
  }

  // Local development / loopback default
  static const EnvConfig dev = EnvConfig(
    baseUrl: 'http://10.0.2.2:3000',
    socketUrl: 'http://10.0.2.2:3000',
    environment: Environment.dev,
  );

  // Android Emulator (10.0.2.2 points to host loopback)
  static const EnvConfig emulator = EnvConfig(
    baseUrl: 'http://10.0.2.2:3000',
    socketUrl: 'http://10.0.2.2:3000',
    environment: Environment.emulator,
  );

  // Staging environment
  static const EnvConfig staging = EnvConfig(
    baseUrl: 'https://staging-api.infurnus.com',
    socketUrl: 'https://staging-api.infurnus.com',
    environment: Environment.staging,
  );

  // Production environment
  static const EnvConfig prod = EnvConfig(
    baseUrl: 'https://api.infurnus.com',
    socketUrl: 'https://api.infurnus.com',
    environment: Environment.prod,
  );
}

EnvConfig get envConfigProvider => EnvConfig.active;
