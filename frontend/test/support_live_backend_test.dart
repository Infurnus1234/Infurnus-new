import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/network/session_events.dart';
import 'package:infurnus/core/storage/secure_storage.dart';

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:infurnus/features/driver/data/datasources/driver_remote_data_source.dart';
import 'package:infurnus/core/services/support_request_id.dart';
import 'package:infurnus/core/errors/support_error_message.dart';

class RealSupportHttp extends HttpOverrides {}

void main() {
  const enabled = bool.fromEnvironment('SUPPORT_LIVE_CONTRACT');
  test(
    'customer app client creates a persistent ticket; actual Admin Panel proxy resolves and closes it',
    () async {
      const backend = 'http://127.0.0.1:3142',
          adminBase = 'http://127.0.0.1:3143';
      final client = Dio();
      client.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () => RealSupportHttp().createHttpClient(null),
      );
      addTearDown(() => client.close(force: true));
      final fixtures =
          (await client.get('$backend/__support_fixture')).data as Map;
      final owner = fixtures['customer'] as Map;
      final adminCookie =
          'infurnus_admin_access=${fixtures['super_admin']['token']}';
      final dio = Dio(
        BaseOptions(
          baseUrl: backend,
          headers: {'Authorization': 'Bearer ${owner['token']}'},
        ),
      );
      dio.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () => RealSupportHttp().createHttpClient(null),
      );
      addTearDown(() => dio.close(force: true));
      final source = DriverRemoteDataSourceImpl(dio);
      Future<Map> create(Map<String, dynamic> body) async =>
          (await source.createSupportTicket(body)).toJson();
      Future<Map> get(String reference) async =>
          (await DriverRemoteDataSourceImpl(dio).getSupportTicket(reference))
              .toJson();
      Future<List<Map>> list() async => (await source.listSupportTickets())
          .map((ticket) => ticket.toJson())
          .toList();

      Future<Map> admin(
        String path, {
        String method = 'GET',
        Map? body,
        int status = 200,
      }) async {
        Response<dynamic> response;
        try {
          response = await client.request(
            '$adminBase/api/backend$path',
            data: body,
            options: Options(
              method: method,
              headers: {
                'Cookie': adminCookie,
                'Origin': adminBase,
                'Content-Type': 'application/json',
              },
            ),
          );
        } on DioException catch (error) {
          if (status < 400 || error.response == null) rethrow;
          response = error.response!;
        }
        expect(response.statusCode, status);
        return response.data as Map;
      }

      final body = {
        'category': 'App',
        'subject': 'TEST_SAMPLE customer cannot book',
        'message': 'TEST_SAMPLE live support lifecycle through the app client.',
        'requestId': supportRequestId(),
      };
      final before = await list();
      try {
        await create({...body, 'message': 'tiny'});
        fail('Invalid input must remain a failed request.');
      } on DioException catch (error) {
        expect(error.response?.statusCode, 400);
        expect(error.response?.data['error']['code'], 'VALIDATION_ERROR');
        expect(
          supportErrorMessage(error),
          'Message must be at least 5 characters.',
        );
        expect(error.response?.data['error']['details'][0]['field'], 'message');
      }
      expect((await list()).length, before.length);
      await expectLater(
        get('INF-SUP-9999999999999999999'),
        throwsA(
          isA<DioException>().having(
            (error) => error.response?.statusCode,
            'status',
            404,
          ),
        ),
      );
      final created = await create(body);
      expect(
        created['ticketNumber'],
        matches(RegExp(r'^INF-SUP-[0-9]{6,19}$')),
      );
      expect(created['status'], 'OPEN');
      expect((await create(body))['id'], created['id']);
      final number = created['ticketNumber'] as String,
          id = created['id'] as String;
      expect((await get(number))['id'], id);
      final page = await client.get(
        '$adminBase/super-admin/support',
        options: Options(headers: {'Cookie': adminCookie}),
      );
      expect(page.statusCode, 200);
      final visible = await admin('/admin/operations/support?search=$number');
      final record = (visible['data']['items'] as List).singleWhere(
        (row) => row['id'] == id,
      ) as Map;
      expect(record['message'], body['message']);
      expect(record['role'], 'customer');
      expect(record['status'], 'OPEN');
      var version = record['version'] as int;
      for (final status in ['UNDER_REVIEW', 'RESOLVED', 'CLOSED']) {
        final result = await admin(
          '/admin/operations/support/$id/status',
          method: 'PATCH',
          body: {'status': status, 'expectedVersion': version},
        );
        version = result['data']['version'] as int;
        expect((await get(number))['status'], status);
        expect(
          (await list()).singleWhere((row) => row['id'] == id)['status'],
          status,
        );
      }
      final persisted = await admin('/admin/operations/support?recordId=$id');
      expect(persisted['data']['items'][0]['status'], 'CLOSED');
      await admin(
        '/admin/operations/support/$id/status',
        method: 'PATCH',
        body: {'status': 'OPEN', 'expectedVersion': version},
        status: 409,
      );
      await expectLater(
        client.get(
          '$backend/support/tickets/$number',
          options: Options(
            headers: {'Authorization': 'Bearer ${fixtures['other']['token']}'},
          ),
        ),
        throwsA(
          isA<DioException>().having(
            (error) => error.response?.statusCode,
            'status',
            403,
          ),
        ),
      );
      final directory = await Directory.systemTemp.createTemp(
        'infurnus-support-session-',
      );
      final jar = PersistCookieJar(storage: FileStorage(directory.path));
      FlutterSecureStorage.setMockInitialValues({});
      final container = ProviderContainer(
        overrides: [cookieJarProvider.overrideWith((ref) async => jar)],
      );
      final sessionDio = container.read(dioProvider);
      sessionDio.options.baseUrl = backend;
      sessionDio.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () => RealSupportHttp().createHttpClient(null),
      );
      try {
        final login = await sessionDio.get('/__support_session/customer');
        final expired = login.data['data']['accessToken'] as String;
        final storage = container.read(secureStorageProvider);
        await storage.write(key: 'auth_token', value: expired);
        await storage.write(key: 'user_id', value: owner['id'] as String);
        final restoredSource = DriverRemoteDataSourceImpl(sessionDio);
        final reads = await Future.wait([
          restoredSource.listSupportTickets(),
          restoredSource.listSupportTickets(),
        ]);
        expect(
          reads.every(
            (tickets) => tickets.any(
              (ticket) => ticket.id == id && ticket.status == 'CLOSED',
            ),
          ),
          isTrue,
        );
        expect(await storage.read(key: 'auth_token'), isNot(expired));
        expect(container.read(sessionRejectionProvider), 0);
        final stats = (await client.get(
          '$backend/__support_session_status/customer',
        )).data;
        expect(stats['records'], 2);
        expect(stats['active'], 1);
      } finally {
        sessionDio.close(force: true);
        container.dispose();
        await directory.delete(recursive: true);
      }
    },
    skip: !enabled,
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
