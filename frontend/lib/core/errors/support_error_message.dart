import 'package:dio/dio.dart';

/// Presentation only: the failed request and its HTTP status remain unchanged.
String supportErrorMessage(Object? error) {
  if (error is DioException) {
    final body = error.response?.data;
    final failure = body is Map ? body['error'] : null;
    if (failure is Map) {
      final details = failure['details'];
      if (details is List) {
        final messages = details
            .whereType<Map>()
            .map((detail) => detail['message'])
            .whereType<String>()
            .where((message) => message.trim().isNotEmpty)
            .toSet();
        if (messages.isNotEmpty) return messages.join('\n');
      }
      final message = failure['message'];
      if (message is String &&
          message.trim().isNotEmpty &&
          message != 'Request validation failed') {
        return message;
      }
    }
    switch (error.response?.statusCode) {
      case 400:
        return 'The support request was rejected. Check the ticket fields and try again.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'You do not have permission to access this ticket.';
      case 404:
        return 'The ticket or support service could not be found. Please refresh and try again.';
    }
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Unable to reach support. Check your connection and try again.';
    }
  }
  return 'Unable to complete the support request. Please try again.';
}
