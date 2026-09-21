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

  static const String _defaultApiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://192.168.0.163:3000',
  );

  // For physical devices on the same LAN (Configurable via --dart-define=API_URL=...)
  static const EnvConfig dev = EnvConfig(
    baseUrl: _defaultApiUrl,
    socketUrl: _defaultApiUrl,
    environment: Environment.dev,
  );

  // For Android Emulator (10.0.2.2 points to host loopback)
  static const EnvConfig emulator = EnvConfig(
    baseUrl: 'http://10.0.2.2:3000',
    socketUrl: 'http://10.0.2.2:3000',
    environment: Environment.emulator,
  );

  static const EnvConfig prod = EnvConfig(
    baseUrl: 'https://api.infurnus.com',
    socketUrl: 'https://api.infurnus.com',
    environment: Environment.prod,
  );
}

// Change this to EnvConfig.emulator if using an Android Emulator
// Change this to EnvConfig.dev if using a physical device on the same network
const envConfigProvider = EnvConfig.dev;
