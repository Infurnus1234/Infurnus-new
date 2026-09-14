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
    baseUrl: 'http://10.0.2.2:3000',
    socketUrl: 'http://10.0.2.2:3000',
    environment: Environment.dev,
  );

  static const EnvConfig prod = EnvConfig(
    baseUrl: 'https://api.infurnus.com',
    socketUrl: 'https://api.infurnus.com',
    environment: Environment.prod,
  );
}

final envConfigProvider = EnvConfig.dev;
