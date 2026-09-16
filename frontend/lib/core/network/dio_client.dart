import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'dart:io';
import 'dart:async';

import '../config/env_config.dart';
import '../storage/secure_storage.dart';

const String _csrfCookieName = 'infurnus_csrf_token';

final cookieJarProvider = FutureProvider<PersistCookieJar>((ref) async {
  final directory = await getApplicationDocumentsDirectory();
  final cookieDirectory = '${directory.path}/.cookies/';
  
  final dir = Directory(cookieDirectory);
  if (!await dir.exists()) {
    await dir.create(recursive: true);
  }

  return PersistCookieJar(
    ignoreExpires: false,
    storage: FileStorage(cookieDirectory),
  );
});

// For concurrent refresh handling
Future<bool>? _refreshFuture;

final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: envConfigProvider.baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: const {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ),
  );

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        debugPrint('Dio: Requesting ${options.method} ${options.uri}');
        debugPrint('Dio: Base URL is ${options.baseUrl}');
        // 1. Ensure CookieJar is attached before any request
        if (!dio.interceptors.any((i) => i is CookieManager)) {
          try {
            final cookieJar = await ref.read(cookieJarProvider.future).timeout(
              const Duration(seconds: 5),
            );
            // Check again inside async block to prevent duplicate additions
            if (!dio.interceptors.any((i) => i is CookieManager)) {
              dio.interceptors.add(CookieManager(cookieJar));
            }
          } catch (e) {
            debugPrint('Failed to initialize CookieJar: $e');
          }
        }

        // 2. Attach Access Token
        final storage = ref.read(secureStorageProvider);
        final accessToken = await storage.read(key: 'auth_token');
        if (accessToken != null && accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $accessToken';
        }

        // 3. Attach CSRF Header (Only for /auth path as per backend)
        if (options.path.startsWith('/auth')) {
          await _addCsrfHeader(dio, options);
        }

        handler.next(options);
      },
      onError: (error, handler) async {
        if (_shouldAttemptRefresh(error)) {
          // Prevent multiple simultaneous refresh calls
          _refreshFuture ??= _performTokenRefresh(dio, ref);
          
          final isRefreshed = await _refreshFuture;
          
          // Clear future after completion
          _refreshFuture = null;

          if (isRefreshed == true) {
            final requestOptions = error.requestOptions;
            
            // Re-fetch token and re-add headers
            final storage = ref.read(secureStorageProvider);
            final newAccessToken = await storage.read(key: 'auth_token');
            if (newAccessToken != null) {
              requestOptions.headers['Authorization'] = 'Bearer $newAccessToken';
            }
            
            if (requestOptions.path.startsWith('/auth')) {
              await _addCsrfHeader(dio, requestOptions);
            }

            // Mark as retried
            requestOptions.extra['refreshAttempted'] = true;

            try {
              final response = await dio.fetch(requestOptions);
              return handler.resolve(response);
            } on DioException catch (retryError) {
              return handler.next(retryError);
            }
          } else {
            // Refresh failed - Clear storage to trigger logout at UI level
            final storage = ref.read(secureStorageProvider);
            await storage.delete(key: 'auth_token');
            await storage.delete(key: 'user_id');
            await storage.delete(key: 'user_role');
          }
        }
        handler.next(error);
      },
    ),
  );

  return dio;
});

Future<void> _addCsrfHeader(Dio dio, RequestOptions options) async {
  // Construct URI for /auth path to match backend cookie scope
  // Backend sets cookie with path '/auth'
  final authUri = Uri.parse(dio.options.baseUrl).replace(path: '/auth');
  
  final cookies = await _getCookiesForRequest(dio, authUri);
  if (cookies == null) return;

  for (var cookie in cookies) {
    if (cookie.name == _csrfCookieName && cookie.value.isNotEmpty) {
      options.headers['X-CSRF-Token'] = cookie.value;
      break;
    }
  }
}

Future<List<Cookie>?> _getCookiesForRequest(Dio dio, Uri uri) async {
  for (final interceptor in dio.interceptors) {
    if (interceptor is CookieManager) {
      return interceptor.cookieJar.loadForRequest(uri);
    }
  }
  return null;
}

bool _shouldAttemptRefresh(DioException error) {
  if (error.response?.statusCode != 401) return false;

  final path = error.requestOptions.path;
  // Don't refresh on primary auth paths to avoid loops
  if (path.contains('/auth/login') ||
      path.contains('/auth/signup') ||
      path.contains('/auth/refresh')) {
    return false;
  }

  return error.requestOptions.extra['refreshAttempted'] != true;
}

Future<bool> _performTokenRefresh(Dio dio, Ref ref) async {
  try {
    final options = Options(
      method: 'POST',
      extra: {'refreshRequest': true},
    );

    // Refresh needs CSRF
    final tempReq = RequestOptions(path: '/auth/refresh', baseUrl: dio.options.baseUrl);
    await _addCsrfHeader(dio, tempReq);
    final csrfToken = tempReq.headers['X-CSRF-Token'];
    
    if (csrfToken != null) {
      options.headers = {'X-CSRF-Token': csrfToken};
    }

    final response = await dio.post('/auth/refresh', options: options);
    final accessToken = response.data['data']?['accessToken'];

    if (accessToken is String && accessToken.isNotEmpty) {
      await ref.read(secureStorageProvider).write(key: 'auth_token', value: accessToken);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}
