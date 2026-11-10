import 'dart:convert';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import 'dart:io';
import 'dart:async';

import '../config/env_config.dart';
import '../storage/secure_storage.dart';
import 'session_events.dart';

const String _csrfCookieName = 'infurnus_csrf_token';

void _traceVehicleFlow(
  RequestOptions options, {
  String stage = 'request',
  int? status,
  dynamic response,
  String? errorCode,
}) {
  if (!const bool.fromEnvironment('VEHICLE_FLOW_DIAGNOSTICS')) return;
  if (![
        '/fares/estimate',
        '/rides/service-availability',
        '/rides',
      ].contains(options.path) ||
      options.method != 'POST' ||
      options.data is! Map) {
    return;
  }
  final request = options.data as Map;
  if (request['vehicleCategory'] is! String) return;
  final data = response is Map ? response['data'] : null;
  final fare = data is Map ? data['bookingFare'] : null;
  debugPrint(
    'VEHICLE_FLOW ${jsonEncode({'stage': stage, 'path': options.path, 'sector': request['sector'], 'vehicleCategory': request['vehicleCategory'], if (status != null) 'status': status, if (errorCode != null) 'errorCode': errorCode, if (data is Map && data['bookable'] is bool) 'bookable': data['bookable'], if (data is Map && data['available'] is bool) 'available': data['available'], if (fare is Map && fare['grossAmount'] is num) 'grossAmountPaise': fare['grossAmount']})}',
  );
}

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

final dioProvider = Provider<Dio>((ref) {
  Future<bool?>? refreshFuture;
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
        _traceVehicleFlow(options);
        debugPrint('Dio: Requesting ${options.method}');
        debugPrint('Dio: Base URL is ${options.baseUrl}');
        // Browsers own HttpOnly cookies; native requests use the persistent jar below.
        if (kIsWeb) options.extra['withCredentials'] = true;

        // 2. Attach Access Token
        final storage = ref.read(secureStorageProvider);
        final accessToken = await storage.read(key: 'auth_token');
        const publicAuthPaths = {
          '/auth/google',
          '/auth/login',
          '/auth/login/verify',
          '/auth/login/resend',
          '/auth/signup',
          '/auth/signup/verify',
          '/auth/signup/resend',
          '/auth/forgot-password',
          '/auth/forgot-password/verify',
          '/auth/reset-password',
        };
        if (publicAuthPaths.contains(options.path)) {
          options.headers.removeWhere(
            (key, _) => key.toLowerCase() == 'authorization',
          );
        } else if (accessToken != null && accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $accessToken';
        }

        // 2b. Attach Provider Mode (for DRIVER_FLEET_OWNER mode switching)
        final providerMode = await storage.read(key: 'provider_mode');
        if (providerMode != null && providerMode.isNotEmpty) {
          options.headers['X-Provider-Mode'] = providerMode;
        }

        // 3. Attach CSRF Header (Only for /auth path as per backend)
        if (options.path.startsWith('/auth')) {
          await _addCsrfHeader(dio, options, ref);
        }

        handler.next(options);
      },
      onResponse: (response, handler) async {
        _traceVehicleFlow(
          response.requestOptions,
          stage: 'response',
          status: response.statusCode,
          response: response.data,
        );
        final body = response.data;
        final data = body is Map ? body['data'] : null;
        final csrf = data is Map ? data['csrfToken'] : null;
        if (csrf is String && csrf.isNotEmpty) {
          await ref
              .read(secureStorageProvider)
              .write(key: 'auth_csrf_token', value: csrf);
        }
        handler.next(response);
      },
      onError: (error, handler) async {
        final body = error.response?.data;
        final details = body is Map ? body['error'] : null;
        _traceVehicleFlow(
          error.requestOptions,
          stage: 'error',
          status: error.response?.statusCode,
          errorCode: details is Map ? details['code'] as String? : null,
        );
        if (_shouldAttemptRefresh(error)) {
          final storage = ref.read(secureStorageProvider);
          final currentToken = await storage.read(key: 'auth_token');
          final sentAuthorization =
              error.requestOptions.headers['Authorization'];
          if (currentToken == null && sentAuthorization != null) {
            // A signed-out session must not be resurrected by a delayed response.
            return handler.next(error);
          }
          bool? isRefreshed;
          if (currentToken != null &&
              sentAuthorization != 'Bearer $currentToken') {
            // Retry with the token already rotated by another request.
            isRefreshed = true;
          } else {
            final pending = refreshFuture ??= _performTokenRefresh(dio, ref);
            try {
              isRefreshed = await pending;
            } finally {
              if (identical(refreshFuture, pending)) refreshFuture = null;
            }
          }

          if (isRefreshed == true) {
            final requestOptions = error.requestOptions;

            // Re-fetch token and re-add headers
            final storage = ref.read(secureStorageProvider);
            final newAccessToken = await storage.read(key: 'auth_token');
            if (newAccessToken != null) {
              requestOptions.headers['Authorization'] =
                  'Bearer $newAccessToken';
            }

            if (requestOptions.path.startsWith('/auth')) {
              await _addCsrfHeader(dio, requestOptions, ref);
            }

            // Mark as retried
            requestOptions.extra['refreshAttempted'] = true;

            try {
              final response = await dio.fetch(requestOptions);
              return handler.resolve(response);
            } on DioException catch (retryError) {
              return handler.next(retryError);
            }
          }
        }
        handler.next(error);
      },
    ),
  );

  if (!kIsWeb) {
    dio.interceptors.add(
      _DeferredCookieManager(() => ref.read(cookieJarProvider.future)),
    );
  }
  return dio;
});

Future<void> _addCsrfHeader(Dio dio, RequestOptions options, Ref ref) async {
  // Construct URI for /auth path to match backend cookie scope
  // Backend sets cookie with path '/auth'
  final authUri = Uri.parse(dio.options.baseUrl).replace(path: '/auth');

  final cookies = await _getCookiesForRequest(dio, authUri);
  if (cookies != null) {
    for (var cookie in cookies) {
      if (cookie.name == _csrfCookieName && cookie.value.isNotEmpty) {
        options.headers['X-CSRF-Token'] = cookie.value;
        return;
      }
    }
  }

  // Fallback to persisted CSRF token if cookie is not yet in cookieJar or empty
  final csrf = await ref
      .read(secureStorageProvider)
      .read(key: 'auth_csrf_token');
  if (csrf != null && csrf.isNotEmpty) {
    options.headers['X-CSRF-Token'] = csrf;
  }
}

Future<List<Cookie>?> _getCookiesForRequest(Dio dio, Uri uri) async {
  for (final interceptor in dio.interceptors) {
    if (interceptor is _DeferredCookieManager) {
      return (await interceptor.manager).cookieJar.loadForRequest(uri);
    }
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
      path.contains('/auth/refresh') ||
      path == '/auth/google' ||
      path.startsWith('/auth/forgot-password') ||
      path == '/auth/reset-password') {
    return false;
  }

  return error.requestOptions.extra['refreshAttempted'] != true;
}

Future<bool?> _performTokenRefresh(Dio dio, Ref ref) async {
  final sessionStorage = ref.read(secureStorageProvider);
  final tokenBeforeRefresh = await sessionStorage.read(key: 'auth_token');
  try {
    final options = Options(
      method: 'POST',
      extra: {'refreshRequest': true, if (kIsWeb) 'withCredentials': true},
    );

    // Refresh needs CSRF
    final tempReq = RequestOptions(
      path: '/auth/refresh',
      baseUrl: dio.options.baseUrl,
    );
    await _addCsrfHeader(dio, tempReq, ref);
    final csrfToken = tempReq.headers['X-CSRF-Token'];

    if (csrfToken != null) {
      options.headers = {'X-CSRF-Token': csrfToken};
    }

    final response = await dio.post('/auth/refresh', options: options);
    final accessToken = response.data['data']?['accessToken'];

    if (accessToken is String && accessToken.isNotEmpty) {
      if (await sessionStorage.read(key: 'auth_token') != tokenBeforeRefresh) {
        return null;
      }
      await ref
          .read(secureStorageProvider)
          .write(key: 'auth_token', value: accessToken);
      return true;
    }
    return null;
  } on DioException catch (error) {
    if (error.response?.statusCode == 401) {
      if (await sessionStorage.read(key: 'auth_token') != tokenBeforeRefresh) {
        return null;
      }
      final storage = ref.read(secureStorageProvider);
      await storage.delete(key: 'auth_token');
      await storage.delete(key: 'user_id');
      await storage.delete(key: 'user_role');
      await storage.delete(key: 'auth_csrf_token');
      ref.read(sessionRejectionProvider.notifier).state++;
      return false;
    }
    return null;
  } catch (_) {
    return null;
  }
}

class _DeferredCookieManager extends Interceptor {
  final Future<CookieJar> Function() _load;
  Future<CookieManager>? _manager;
  _DeferredCookieManager(this._load);
  Future<CookieManager> get manager =>
      _manager ??= _load().then(CookieManager.new);
  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    try {
      await (await manager).onRequest(options, handler);
    } catch (error, stack) {
      handler.reject(
        DioException(requestOptions: options, error: error, stackTrace: stack),
      );
    }
  }

  @override
  Future<void> onResponse(
    Response response,
    ResponseInterceptorHandler handler,
  ) async {
    try {
      await (await manager).onResponse(response, handler);
    } catch (error, stack) {
      handler.reject(
        DioException(
          requestOptions: response.requestOptions,
          error: error,
          stackTrace: stack,
        ),
      );
    }
  }
}
