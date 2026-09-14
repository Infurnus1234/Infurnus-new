abstract class Failure {
  final String message;
  Failure(this.message);
}

class ServerFailure extends Failure {
  ServerFailure([super.message = 'A server error occurred']);
}

class NetworkFailure extends Failure {
  NetworkFailure([super.message = 'No internet connection']);
}

class AuthFailure extends Failure {
  AuthFailure([super.message = 'Authentication failed']);
}
