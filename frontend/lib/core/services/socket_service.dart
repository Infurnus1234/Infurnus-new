import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/env_config.dart';

class SocketService {
  late io.Socket _socket;

  void connect(String token) {
    _socket = io.io(EnvConfig.dev.socketUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {'token': token}
    });

    _socket.connect();

    _socket.onConnect((_) {
      print('Connected to Socket.IO server');
    });

    _socket.onDisconnect((_) {
      print('Disconnected from Socket.IO server');
    });
  }

  void emit(String event, dynamic data) {
    _socket.emit(event, data);
  }

  void on(String event, Function(dynamic) handler) {
    _socket.on(event, handler);
  }

  void disconnect() {
    _socket.disconnect();
  }
}

final socketServiceProvider = Provider((ref) => SocketService());
