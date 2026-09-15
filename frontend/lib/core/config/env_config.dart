enum Environment { dev, staging, prod }

class EnvConfig {
  final String baseUrl;
  final String socketUrl;
  final Environment environment;

  const EnvConfig({
    required this.baseUrl,
    required this.socketUrl,
    required this.environment,
  });

  static const EnvConfig dev = EnvConfig(
    baseUrl: 'http://192.168.0.163:3001',
    socketUrl: 'http://192.168.0.163:3001',
    environment: Environment.dev,
  );

  static const EnvConfig prod = EnvConfig(
    baseUrl: 'https://api.infurnus.com',
    socketUrl: 'https://api.infurnus.com',
    environment: Environment.prod,
  );
}

final envConfigProvider = EnvConfig.dev;

