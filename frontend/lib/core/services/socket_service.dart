import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/env_config.dart';

enum SocketConnectionState { connecting, connected, disconnected, error }

class SocketServerEvent {
  final String name;
  final dynamic data;

  SocketServerEvent({required this.name, required this.data});
}

class SocketService {
  io.Socket? _socket;
  
  // Stream controllers for broadcasting state and events
  final _stateController = StreamController<SocketConnectionState>.broadcast();
  final _eventController = StreamController<SocketServerEvent>.broadcast();

  Stream<SocketConnectionState> get stateStream => _stateController.stream;
  Stream<SocketServerEvent> get eventStream => _eventController.stream;

  SocketConnectionState _currentState = SocketConnectionState.disconnected;
  SocketConnectionState get currentState => _currentState;

  void _updateState(SocketConnectionState state) {
    _currentState = state;
    _stateController.add(state);
  }

  /// Connects to the Socket.IO server with the provided access token.
  /// If already connected, it will disconnect first to ensure the new token is used.
  void connect(String token) {
    if (_socket != null) {
      disconnect();
    }

    _updateState(SocketConnectionState.connecting);

    // Backend contract: Namespace default '/', Handshake auth: { token: accessToken }
    _socket = io.io(envConfigProvider.socketUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {'token': token},
    });

    _socket?.onConnect((_) {
      _updateState(SocketConnectionState.connected);
    });

    _socket?.onDisconnect((_) {
      _updateState(SocketConnectionState.disconnected);
    });

    _socket?.onConnectError((_) {
      _updateState(SocketConnectionState.error);
    });

    _socket?.onError((_) {
      _updateState(SocketConnectionState.error);
    });

    // Register server-to-client events based on backend contract
    final serverEvents = [
      'ride:driver_assigned',
      'ride:driver_location_updated',
      'ride:lifecycle_updated',
      'ride:route_updated',
      'ride:incoming',
      'ride:taken',
      'ride:cancelled',
    ];

    for (var eventName in serverEvents) {
      _socket?.on(eventName, (data) {
        _eventController.add(SocketServerEvent(name: eventName, data: data));
      });
    }

    _socket?.connect();
  }

  /// Disconnects the current socket session and cleans up resources.
  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _updateState(SocketConnectionState.disconnected);
  }

  // --- Client-to-Server Methods ---

  void joinRide(String rideId) {
    _socket?.emit('ride:join', rideId);
  }

  void leaveRide(String rideId) {
    _socket?.emit('ride:leave', rideId);
  }

  void updateDriverLocation({
    required String rideId,
    required double latitude,
    required double longitude,
    required DateTime timestamp,
  }) {
    _socket?.emit('driver:location', {
      'rideId': rideId,
      'latitude': latitude,
      'longitude': longitude,
      'timestamp': timestamp.toIso8601String(),
    });
  }

  void acceptRide(String rideId) {
    _socket?.emit('driver:accept', rideId);
  }

  void updateRideStatus(String rideId, String status) {
    _socket?.emit('ride:status', {
      'rideId': rideId,
      'status': status,
    });
  }

  /// Called when the provider is disposed.
  void dispose() {
    disconnect();
    _stateController.close();
    _eventController.close();
  }
}

final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService();
  ref.onDispose(() => service.dispose());
  return service;
});
