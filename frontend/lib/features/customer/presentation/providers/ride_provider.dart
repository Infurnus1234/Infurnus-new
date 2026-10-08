import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../../core/services/cashfree_checkout_service.dart';
import '../../../../core/services/geocoding_service.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/services/socket_service.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/fare_estimate_model.dart';
import '../../data/models/ride_model.dart' as model;
import '../../data/models/route_model.dart';
import 'ride_use_case_providers.dart';

enum RideStatus {
  initial,
  searching,
  matched,
  arrived,
  active,
  completed,
  cancelled,
  error,
}

class DriverLocation {
  final double latitude;
  final double longitude;
  final DateTime timestamp;

  DriverLocation({
    required this.latitude,
    required this.longitude,
    required this.timestamp,
  });
}

class RideState {
  final RideStatus status;
  final String? pickup;
  final String? destination;
  final LatLng? pickupCoords;
  final LatLng? destinationCoords;
  final String selectedSector;
  final String selectedTier;
  final double? fare;
  final FareEstimateModel? fareEstimate;
  final double? distanceKm;
  final int? durationMinutes;
  final int? waitingMinutes;
  final bool isEstimatingFare;
  final String? driverName;
  final String? vehicleInfo;
  final model.RideModel? currentRide;
  final List<model.RideModel> history;
  final String? errorMessage;
  final String? mapError;
  final DriverLocation? lastDriverLocation;
  final RouteModel? currentRoute;
  final int? userRating;
  final String? userReview;
  final bool isReviewSubmitted;
  final Map<String, dynamic>? goods;
  final Map<String, dynamic>? serviceDetails;
  final Map<String, dynamic>? rentalDetails;
  final String paymentStatus; // 'unpaid', 'processing', 'paid'
  final String? paymentId;
  final String? paymentMethod;
  final List<Map<String, dynamic>> recentPayments;

  RideState({
    this.status = RideStatus.initial,
    this.pickup,
    this.destination,
    this.pickupCoords,
    this.destinationCoords,
    this.selectedSector = 'passenger',
    this.selectedTier = '',
    this.fare,
    this.fareEstimate,
    this.distanceKm,
    this.durationMinutes,
    this.waitingMinutes,
    this.isEstimatingFare = false,
    this.driverName,
    this.vehicleInfo,
    this.currentRide,
    this.history = const [],
    this.errorMessage,
    this.mapError,
    this.lastDriverLocation,
    this.currentRoute,
    this.userRating,
    this.userReview,
    this.isReviewSubmitted = false,
    this.goods,
    this.serviceDetails,
    this.rentalDetails,
    this.paymentStatus = 'unpaid',
    this.paymentId,
    this.paymentMethod,
    this.recentPayments = const [],
  });

  RideState copyWith({
    RideStatus? status,
    String? pickup,
    String? destination,
    LatLng? pickupCoords,
    LatLng? destinationCoords,
    bool clearPickupCoords = false,
    bool clearDestinationCoords = false,
    String? selectedSector,
    String? selectedTier,
    double? fare,
    FareEstimateModel? fareEstimate,
    bool clearFareData = false,
    double? distanceKm,
    int? durationMinutes,
    int? waitingMinutes,
    bool? isEstimatingFare,
    String? driverName,
    String? vehicleInfo,
    model.RideModel? currentRide,
    List<model.RideModel>? history,
    String? errorMessage,
    String? mapError,
    bool clearMapData = false,
    bool clearRide = false,
    DriverLocation? lastDriverLocation,
    RouteModel? currentRoute,
    int? userRating,
    String? userReview,
    bool? isReviewSubmitted,
    Map<String, dynamic>? goods,
    Map<String, dynamic>? serviceDetails,
    Map<String, dynamic>? rentalDetails,
    String? paymentStatus,
    String? paymentId,
    String? paymentMethod,
    List<Map<String, dynamic>>? recentPayments,
  }) {
    return RideState(
      status: status ?? this.status,
      pickup: pickup ?? this.pickup,
      destination: destination ?? this.destination,
      pickupCoords: clearPickupCoords
          ? null
          : pickupCoords ?? this.pickupCoords,
      destinationCoords: clearDestinationCoords
          ? null
          : destinationCoords ?? this.destinationCoords,
      selectedSector: selectedSector ?? this.selectedSector,
      selectedTier: selectedTier ?? this.selectedTier,
      fare: clearFareData ? null : fare ?? this.fare,
      fareEstimate: clearFareData ? null : fareEstimate ?? this.fareEstimate,
      distanceKm: clearFareData ? null : distanceKm ?? this.distanceKm,
      durationMinutes: clearFareData
          ? null
          : durationMinutes ?? this.durationMinutes,
      waitingMinutes: waitingMinutes ?? this.waitingMinutes,
      isEstimatingFare: isEstimatingFare ?? this.isEstimatingFare,
      driverName: driverName ?? this.driverName,
      vehicleInfo: vehicleInfo ?? this.vehicleInfo,
      currentRide: clearRide ? null : currentRide ?? this.currentRide,
      history: history ?? this.history,
      errorMessage: errorMessage,
      mapError: mapError,
      lastDriverLocation: clearMapData
          ? null
          : lastDriverLocation ?? this.lastDriverLocation,
      currentRoute: clearMapData ? null : currentRoute ?? this.currentRoute,
      userRating: userRating ?? this.userRating,
      userReview: userReview ?? this.userReview,
      isReviewSubmitted: isReviewSubmitted ?? this.isReviewSubmitted,
      goods: goods ?? this.goods,
      serviceDetails: serviceDetails ?? this.serviceDetails,
      rentalDetails: rentalDetails ?? this.rentalDetails,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      paymentId: paymentId ?? this.paymentId,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      recentPayments: recentPayments ?? this.recentPayments,
    );
  }
}

class RideNotifier extends StateNotifier<RideState> {
  final Ref ref;
  StreamSubscription<SocketServerEvent>? _eventSubscription;
  int _fareEstimateGeneration = 0;
  int _mapGeneration = 0;
  int _locationGeneration = 0;
  StreamSubscription<SocketConnectionState>? _socketStateSubscription;
  Future<bool>? _pendingFare;
  String? _pendingFareKey;
  int? _pendingFareGeneration;

  RideNotifier(this.ref) : super(RideState()) {
    _subscribeToSocketEvents();
    _socketStateSubscription = ref
        .read(socketServiceProvider)
        .stateStream
        .listen((connection) {
          final id = state.currentRide?.id;
          if (connection == SocketConnectionState.connected &&
              id != null &&
              _activeRide) {
            ref.read(socketServiceProvider).joinRide(id);
            refreshRideMap();
          } else if (connection == SocketConnectionState.error ||
              connection == SocketConnectionState.disconnected) {
            if (mounted && _activeRide) {
              state = state.copyWith(
                mapError: 'Live connection interrupted; showing last update.',
              );
            }
          }
        });
  }

  bool get _activeRide =>
      state.currentRide != null &&
      state.status != RideStatus.completed &&
      state.status != RideStatus.cancelled;

  Future<void> refreshRideMap() async {
    final generation = ++_mapGeneration;
    final locationGeneration = _locationGeneration;
    final id = state.currentRide?.id;
    final pickup = state.pickupCoords, drop = state.destinationCoords;
    if (id == null && (pickup == null || drop == null)) return;
    if (id != null && !_activeRide) return;
    try {
      final dio = ref.read(dioProvider);
      final response = id != null
          ? await dio.get(
              '/rides/$id/map',
              queryParameters: {'includeRoute': true},
            )
          : await dio.post(
              '/maps/route',
              data: {
                'origin': {
                  'latitude': pickup!.latitude,
                  'longitude': pickup.longitude,
                },
                'destination': {
                  'latitude': drop!.latitude,
                  'longitude': drop.longitude,
                },
              },
            );
      if (!mounted ||
          generation != _mapGeneration ||
          id != state.currentRide?.id) {
        return;
      }
      final data = response.data['data'] as Map<String, dynamic>;
      final route = id == null ? data : data['route'];
      final location = id == null ? null : data['driverLocation'];
      final currentLocation = locationGeneration != _locationGeneration
          ? state.lastDriverLocation
          : _parseDriverLocation(location);
      state = state.copyWith(
        clearMapData: true,
        mapError: route == null
            ? 'Road route unavailable; showing selected locations.'
            : null,
      );
      state = state.copyWith(
        currentRoute: route is Map<String, dynamic>
            ? RouteModel.fromJson(route)
            : null,
        lastDriverLocation: currentLocation,
        mapError: state.mapError,
      );
    } catch (_) {
      if (mounted && generation == _mapGeneration) {
        state = state.copyWith(
          currentRoute: pickup != null && drop != null
              ? const RouteModel(distanceMeters: 5000, durationSeconds: 600)
              : null,
          mapError: 'Map route unavailable. Please retry.',
        );
      }
    }
  }

  DriverLocation? _parseDriverLocation(dynamic data) {
    if (data is! Map || data['latitude'] is! num || data['longitude'] is! num) {
      return null;
    }
    final lat = (data['latitude'] as num).toDouble(),
        lng = (data['longitude'] as num).toDouble();
    final timestamp = DateTime.tryParse(data['timestamp']?.toString() ?? '');
    if (!GeocodingService.validCoordinates(lat, lng) || timestamp == null) {
      return null;
    }
    if (state.lastDriverLocation != null &&
        timestamp.isBefore(state.lastDriverLocation!.timestamp)) {
      return null;
    }
    return DriverLocation(latitude: lat, longitude: lng, timestamp: timestamp);
  }

  void _subscribeToSocketEvents() {
    _eventSubscription?.cancel();
    _eventSubscription = ref.read(socketServiceProvider).eventStream.listen((
      event,
    ) {
      _handleSocketEvent(event);
    });
  }

  void _handleSocketEvent(SocketServerEvent event) {
    if (state.currentRide == null || event.data is! Map) return;

    switch (event.name) {
      case 'ride:driver_assigned':
      case 'ride:lifecycle_updated':
      case 'ride:completed':
        final rideData = event.data['ride'];
        if (rideData != null && rideData is Map<String, dynamic>) {
          final updatedRide = model.RideModel.fromJson(rideData);
          if (updatedRide.id == state.currentRide?.id) {
            state = state.copyWith(
              status: _mapBackendStatus(updatedRide.status),
              currentRide: updatedRide,
              driverName: updatedRide.driverDetails?.name,
              vehicleInfo: updatedRide.vehicleDetails != null
                  ? '${updatedRide.vehicleDetails!.make} ${updatedRide.vehicleDetails!.model} • ${updatedRide.vehicleDetails!.plateNumber}'
                  : null,
            );
            _checkRoomLifecycle(updatedRide.status);
            _mapGeneration++;
            state = state.copyWith(clearMapData: true);
            if (_activeRide) {
              refreshRideMap();
            } else {
              state = state.copyWith(clearMapData: true);
            }
          }
        }
        break;

      case 'ride:driver_location_updated':
        final rideId = event.data['rideId'];
        if (rideId == state.currentRide?.id) {
          final locationData = event.data['location'];
          final location = _parseDriverLocation(locationData);
          if (location != null && _activeRide) {
            _locationGeneration++;
            state = state.copyWith(lastDriverLocation: location);
          }
        }
        break;

      case 'ride:route_updated':
        final rideId = event.data['rideId'];
        if (rideId == state.currentRide?.id) {
          final routeData = event.data['route'];
          final expectedSegment = state.status == RideStatus.active
              ? 'destination'
              : 'pickup';
          if (event.data['segment'] != null &&
              event.data['segment'] != expectedSegment) {
            return;
          }
          if (_activeRide &&
              routeData != null &&
              routeData is Map<String, dynamic>) {
            try {
              state = state.copyWith(
                currentRoute: RouteModel.fromJson(routeData),
              );
            } catch (_) {
              state = state.copyWith(
                mapError: 'Invalid route update. Please retry.',
              );
            }
          }
        }
        break;
      case 'ride:cancelled':
        if (event.data['rideId'] == state.currentRide?.id) {
          _mapGeneration++;
          state = state.copyWith(
            status: RideStatus.cancelled,
            clearMapData: true,
          );
          ref.read(socketServiceProvider).leaveRide(state.currentRide!.id);
        }
        break;
    }
  }

  Future<void> _ensureSocketConnected() async {
    final socketService = ref.read(socketServiceProvider);
    if (socketService.currentState != SocketConnectionState.connected) {
      final token = await ref
          .read(secureStorageProvider)
          .read(key: 'auth_token');
      if (token != null) {
        socketService.connect(token);
      }
    }
  }

  void _checkRoomLifecycle(model.RideStatus backendStatus) {
    if (backendStatus == model.RideStatus.completed ||
        backendStatus == model.RideStatus.cancelled) {
      if (state.currentRide?.id != null) {
        ref.read(socketServiceProvider).leaveRide(state.currentRide!.id);
      }
    }
  }

  void setRoute(
    String pickup,
    String dest, {
    LatLng? pickupCoords,
    LatLng? destCoords,
    String? sector,
    String? vehicleCategory,
    Map<String, dynamic>? goods,
  }) {
    if (state.pickup == pickup &&
        state.destination == dest &&
        (pickupCoords == null || pickupCoords == state.pickupCoords) &&
        (destCoords == null || destCoords == state.destinationCoords) &&
        (sector == null || sector == state.selectedSector) &&
        (vehicleCategory == null || vehicleCategory == state.selectedTier) &&
        (goods == null || mapEquals(goods, state.goods))) {
      return;
    }
    _fareEstimateGeneration++;
    _mapGeneration++;
    final preservePickupCoords = state.pickup == pickup;
    final preserveDestinationCoords = state.destination == dest;
    state = state.copyWith(
      pickup: pickup,
      destination: dest,
      pickupCoords:
          pickupCoords ?? (preservePickupCoords ? state.pickupCoords : null),
      destinationCoords:
          destCoords ??
          (preserveDestinationCoords ? state.destinationCoords : null),
      clearPickupCoords: pickupCoords == null && !preservePickupCoords,
      clearDestinationCoords: destCoords == null && !preserveDestinationCoords,
      selectedSector: sector,
      selectedTier: vehicleCategory,
      goods: goods,
      clearFareData: true,
      isEstimatingFare: false,
      status: RideStatus.initial,
      errorMessage: null,
      lastDriverLocation: null,
      currentRoute: null,
      clearMapData: true,
      clearRide: true,
    );
    if (state.pickupCoords != null && state.destinationCoords != null) {
      refreshRideMap();
      estimateRouteFare();
    }
  }

  Future<bool> geocodeAndSetPickup(String address) async {
    final trimmed = address.trim();
    if (trimmed.isEmpty) return false;

    if (trimmed.toLowerCase() == 'current location') {
      if (state.pickupCoords != null) {
        setPickupCoords(state.pickupCoords!, address: 'Current Location');
        return true;
      }
      try {
        final pos = await ref
            .read(locationServiceProvider)
            .getCurrentPosition();
        if (pos == null) {
          throw const LocationUnavailableException(
            'Your current location is unavailable. Check GPS and try again.',
          );
        }
        setPickupCoords(
          LatLng(pos.latitude, pos.longitude),
          address: 'Current Location',
        );
        return true;
      } on LocationUnavailableException catch (error) {
        state = state.copyWith(errorMessage: error.message);
        return false;
      } catch (_) {
        state = state.copyWith(
          errorMessage:
              'Your current location is unavailable. Check GPS and try again.',
        );
        return false;
      }
    }

    LatLng? coords;
    try {
      coords = await ref.read(geocodingServiceProvider).geocodeAddress(trimmed);
    } catch (_) {
      if (mounted) {
        state = state.copyWith(
          errorMessage: 'Location lookup unavailable. Please retry.',
        );
      }
      return false;
    }
    if (!mounted) return false;
    if (coords != null) {
      setPickupCoords(coords, address: trimmed);
      return true;
    } else {
      state = state.copyWith(
        errorMessage: 'Unable to locate "$trimmed". Please check the address.',
      );
      return false;
    }
  }

  Future<bool> geocodeAndSetDestination(String address) async {
    final trimmed = address.trim();
    if (trimmed.isEmpty) return false;

    if (trimmed.toLowerCase() == 'current location') {
      if (state.destinationCoords != null) {
        setDestinationCoords(
          state.destinationCoords!,
          address: 'Current Location',
        );
        return true;
      }
      try {
        final pos = await ref
            .read(locationServiceProvider)
            .getCurrentPosition();
        if (pos == null) {
          throw const LocationUnavailableException(
            'Your current location is unavailable. Check GPS and try again.',
          );
        }
        setDestinationCoords(
          LatLng(pos.latitude, pos.longitude),
          address: 'Current Location',
        );
        return true;
      } on LocationUnavailableException catch (error) {
        state = state.copyWith(errorMessage: error.message);
        return false;
      } catch (_) {
        state = state.copyWith(
          errorMessage:
              'Your current location is unavailable. Check GPS and try again.',
        );
        return false;
      }
    }

    if (trimmed.toLowerCase().contains('standby') ||
        trimmed.toLowerCase().contains('as directed')) {
      final coords = state.pickupCoords;
      if (coords == null) {
        state = state.copyWith(errorMessage: 'Select a pickup location first.');
        return false;
      }
      setDestinationCoords(coords, address: trimmed);
      return true;
    }

    LatLng? coords;
    try {
      coords = await ref.read(geocodingServiceProvider).geocodeAddress(trimmed);
    } catch (_) {
      if (mounted) {
        state = state.copyWith(
          errorMessage: 'Location lookup unavailable. Please retry.',
        );
      }
      return false;
    }
    if (!mounted) return false;
    if (coords != null) {
      setDestinationCoords(coords, address: trimmed);
      return true;
    } else {
      state = state.copyWith(
        errorMessage: 'Unable to locate "$trimmed". Please check the address.',
      );
      return false;
    }
  }

  void setPickupCoords(LatLng coords, {String? address}) {
    if (!GeocodingService.validCoordinates(coords.latitude, coords.longitude)) {
      return;
    }
    _mapGeneration++;
    state = state.copyWith(
      clearMapData: true,
      pickupCoords: coords,
      pickup: address ?? state.pickup,
    );
    if (state.destinationCoords != null) {
      refreshRideMap();
      estimateRouteFare();
    }
  }

  void updatePickupAddress(String address) {
    _mapGeneration++;
    _fareEstimateGeneration++;
    state = state.copyWith(
      pickup: address,
      clearPickupCoords: true,
      clearMapData: true,
      clearFareData: true,
      isEstimatingFare: false,
    );
  }

  void setPickupAddress(String address) {
    state = state.copyWith(pickup: address);
  }

  void setDestinationCoords(LatLng coords, {String? address}) {
    if (!GeocodingService.validCoordinates(coords.latitude, coords.longitude)) {
      return;
    }
    _mapGeneration++;
    state = state.copyWith(
      clearMapData: true,
      destinationCoords: coords,
      destination: address ?? state.destination,
    );
    if (state.pickupCoords != null) {
      refreshRideMap();
      estimateRouteFare();
    }
  }

  void updateDestinationAddress(String address) {
    _mapGeneration++;
    _fareEstimateGeneration++;
    state = state.copyWith(
      destination: address,
      clearDestinationCoords: true,
      clearMapData: true,
      clearFareData: true,
      isEstimatingFare: false,
    );
  }

  void selectSector(String sector) {
    state = state.copyWith(selectedSector: sector, selectedTier: '');
    estimateRouteFare();
  }

  void selectTier(String tier) {
    state = state.copyWith(selectedTier: tier);
    estimateRouteFare();
  }

  void setGoods(Map<String, dynamic> goods) {
    state = state.copyWith(goods: goods);
    estimateRouteFare();
  }

  void setServiceDetails(Map<String, dynamic> serviceDetails) {
    state = state.copyWith(serviceDetails: serviceDetails);
    estimateRouteFare();
  }

  void setRentalDetails(Map<String, dynamic> rentalDetails) {
    state = state.copyWith(rentalDetails: rentalDetails);
    estimateRouteFare();
  }

  void setWaitingMinutes(int minutes) {
    state = state.copyWith(waitingMinutes: minutes);
    estimateRouteFare();
  }

  Future<bool> estimateRouteFare() {
    final key = jsonEncode([
      state.pickupCoords?.latitude,
      state.pickupCoords?.longitude,
      state.destinationCoords?.latitude,
      state.destinationCoords?.longitude,
      state.selectedSector,
      state.selectedTier,
      state.goods,
      state.serviceDetails,
      state.rentalDetails,
      state.waitingMinutes,
    ]);
    if (_pendingFare != null &&
        _pendingFareKey == key &&
        _pendingFareGeneration == _fareEstimateGeneration) {
      return _pendingFare!;
    }
    final request = _performFareEstimate();
    _pendingFare = request;
    _pendingFareKey = key;
    _pendingFareGeneration = _fareEstimateGeneration;
    return request.whenComplete(() {
      if (identical(_pendingFare, request)) _pendingFare = null;
    });
  }

  Future<bool> _performFareEstimate() async {
    final generation = ++_fareEstimateGeneration;
    if (state.pickupCoords == null ||
        state.destinationCoords == null ||
        state.selectedTier.trim().isEmpty) {
      state = state.copyWith(clearFareData: true, isEstimatingFare: false);
      return false;
    }

    final pickup = state.pickupCoords!;
    final destination = state.destinationCoords!;
    final sector = state.selectedSector;
    final vehicleCategory = state.selectedTier;
    final goods = state.goods;
    final serviceDetails = state.serviceDetails;
    final rentalDetails = state.rentalDetails;
    final waitingMinutes = state.waitingMinutes;

    state = state.copyWith(
      isEstimatingFare: true,
      clearFareData: true,
      errorMessage: null,
    );

    try {
      final payload = <String, dynamic>{
        'pickup': {'latitude': pickup.latitude, 'longitude': pickup.longitude},
        'destination': {
          'latitude': destination.latitude,
          'longitude': destination.longitude,
        },
        'sector': sector,
        'vehicleCategory': vehicleCategory,
      };

      if (goods != null) {
        payload['goods'] = goods;
        if (goods['weightKg'] != null) {
          payload['weightKg'] = goods['weightKg'];
        }
        if (goods['hasLoadingAssistance'] != null ||
            goods['loadingAssistance'] != null) {
          payload['hasLoadingAssistance'] =
              goods['hasLoadingAssistance'] ?? goods['loadingAssistance'];
        }
      }
      if (serviceDetails != null) {
        payload['serviceDetails'] = serviceDetails;
      }
      if (rentalDetails != null) {
        payload['rentalDetails'] = rentalDetails;
        if (rentalDetails['hours'] != null) {
          payload['rentalHours'] = rentalDetails['hours'];
        }
        if (rentalDetails['fuelRatePerKm'] != null) {
          payload['fuelRatePerKm'] = rentalDetails['fuelRatePerKm'];
        }
      }
      if (waitingMinutes != null && waitingMinutes > 0) {
        payload['waitingMinutes'] = waitingMinutes;
      }

      final estimate = await ref
          .read(estimateFareUseCaseProvider)
          .execute(payload);

      if (!mounted || generation != _fareEstimateGeneration) return false;
      state = state.copyWith(
        fareEstimate: estimate,
        fare: estimate.bookingAmount,
        distanceKm: estimate.distanceKm,
        durationMinutes: estimate.durationMinutes,
        isEstimatingFare: false,
        errorMessage: null,
      );
      return true;
    } catch (e) {
      if (!mounted || generation != _fareEstimateGeneration) return false;
      state = state.copyWith(
        isEstimatingFare: false,
        errorMessage: 'Fare calculation unavailable: ${e.toString()}',
      );
      return false;
    }
  }

  Future<void> requestRide() async {
    if (state.status == RideStatus.searching) return;

    if (state.pickupCoords == null || state.destinationCoords == null) {
      state = state.copyWith(
        errorMessage: 'Please select valid pickup and destination locations',
      );
      return;
    }

    state = state.copyWith(status: RideStatus.searching, errorMessage: null);

    try {
      final quoteReady =
          state.fareEstimate != null || await estimateRouteFare();
      if (!mounted) return;
      if (!quoteReady ||
          state.fareEstimate == null ||
          state.fareEstimate!.bookingAmount == null) {
        state = state.copyWith(
          status: RideStatus.error,
          errorMessage:
              state.errorMessage ??
              state.fareEstimate?.message ??
              'A current fare estimate is required to book.',
        );
        return;
      }

      final pickup = state.pickupCoords!;
      final destination = state.destinationCoords!;

      final data = <String, dynamic>{
        'pickup': {'latitude': pickup.latitude, 'longitude': pickup.longitude},
        'destination': {
          'latitude': destination.latitude,
          'longitude': destination.longitude,
        },
        'pickupAddress': state.pickup ?? 'Current Location',
        'destinationAddress': state.destination ?? 'Destination',
        'sector': state.selectedSector,
        'vehicleCategory': state.selectedTier,
      };

      if (state.goods != null) {
        data['goods'] = state.goods;
      }
      if (state.serviceDetails != null) {
        data['serviceDetails'] = state.serviceDetails;
      }
      if (state.rentalDetails != null) {
        data['rentalDetails'] = state.rentalDetails;
      }

      if (state.selectedSector == 'passenger' && state.waitingMinutes != null) {
        data['waitingMinutes'] = state.waitingMinutes;
      }

      final ride = await ref.read(createRideUseCaseProvider).execute(data);

      state = state.copyWith(
        status: _mapBackendStatus(ride.status),
        currentRide: ride,
        paymentStatus: 'unpaid',
      );

      await _ensureSocketConnected();
      ref.read(socketServiceProvider).joinRide(ride.id);
    } catch (e) {
      state = state.copyWith(
        status: RideStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  Future<void> fetchRideHistory() async {
    try {
      final history = await ref
          .read(listRidesUseCaseProvider)
          .execute(limit: 20);
      state = state.copyWith(history: history);
    } catch (e) {
      state = state.copyWith(errorMessage: e.toString());
    }
  }

  Future<void> getRideDetails(String id) async {
    try {
      final ride = await ref.read(getRideUseCaseProvider).execute(id);
      state = state.copyWith(
        status: _mapBackendStatus(ride.status),
        currentRide: ride,
        driverName: ride.driverDetails?.name,
        vehicleInfo: ride.vehicleDetails != null
            ? '${ride.vehicleDetails!.make} ${ride.vehicleDetails!.model} • ${ride.vehicleDetails!.plateNumber}'
            : null,
      );

      await _ensureSocketConnected();
      ref.read(socketServiceProvider).joinRide(id);
      _checkRoomLifecycle(ride.status);
      refreshRideMap();
    } catch (e) {
      state = state.copyWith(errorMessage: e.toString());
    }
  }

  Future<void> cancelRide() async {
    final rideId = state.currentRide?.id;
    if (rideId == null) return;

    try {
      final ride = await ref
          .read(cancelRideUseCaseProvider)
          .execute(rideId, 'Cancelled by user');

      ref.read(socketServiceProvider).leaveRide(rideId);

      state = state.copyWith(status: RideStatus.cancelled, currentRide: ride);
      fetchRideHistory();
    } catch (e) {
      state = state.copyWith(errorMessage: e.toString());
    }
  }

  Future<void> rateAndReviewRide(int rating, String comment) async {
    final rideId = state.currentRide?.id;
    state = state.copyWith(
      userRating: rating,
      userReview: comment,
      isReviewSubmitted: true,
    );

    if (rideId != null) {
      try {
        await ref
            .read(submitRatingUseCaseProvider)
            .execute(
              rideId: rideId,
              rating: rating,
              review: comment.trim().isNotEmpty ? comment.trim() : null,
            );
      } catch (_) {
        // Non-blocking fallback
      }
    }
  }

  Future<bool> initiateTripPayment({
    required double amount,
    required String paymentMethod,
  }) async {
    final rideId = state.currentRide?.id;
    if (rideId == null) return false;

    state = state.copyWith(paymentStatus: 'processing', errorMessage: null);

    try {
      final initiateResult = await ref
          .read(initiatePaymentUseCaseProvider)
          .execute(
            rideId: rideId,
            amount: amount,
            paymentMethod: paymentMethod,
          );

      final paymentId = initiateResult['id']?.toString();
      if (paymentId == null) {
        throw Exception('Payment initiation did not return a valid payment ID');
      }

      state = state.copyWith(
        paymentId: paymentId,
        paymentMethod: paymentMethod,
      );

      if (paymentMethod.toLowerCase() == 'cashfree') {
        final paymentSessionId = initiateResult['paymentSessionId']?.toString();
        final providerOrderId = initiateResult['providerOrderId']?.toString();

        if (paymentSessionId == null || paymentSessionId.isEmpty) {
          throw Exception('Payment session ID not returned by gateway');
        }

        final checkoutService = ref.read(cashfreeCheckoutServiceProvider);
        final checkoutResult = await checkoutService.startCheckout(
          orderId: providerOrderId ?? 'order_$paymentId',
          paymentSessionId: paymentSessionId,
        );

        if (checkoutResult.status == CashfreeCheckoutStatus.cancelled) {
          state = state.copyWith(
            paymentStatus: 'unpaid',
            errorMessage: 'Payment was cancelled by user',
          );
          return false;
        }

        if (checkoutResult.status == CashfreeCheckoutStatus.failed) {
          state = state.copyWith(
            paymentStatus: 'unpaid',
            errorMessage:
                checkoutResult.errorMessage ?? 'Payment failed at gateway',
          );
          return false;
        }

        // Server-side verification: Flutter callback alone never marks payment as paid.
        final captureResult = await ref
            .read(capturePaymentUseCaseProvider)
            .execute(
              paymentId: paymentId,
              providerPaymentId: checkoutResult.referenceId,
            );

        if (captureResult['status'] == 'CAPTURED') {
          state = state.copyWith(paymentStatus: 'paid', errorMessage: null);
          fetchPaymentHistory();
          return true;
        } else {
          state = state.copyWith(
            paymentStatus: 'unpaid',
            errorMessage: 'Payment verification failed at server',
          );
          return false;
        }
      } else {
        // Non-Cashfree provider (e.g. wallet/cash)
        final captureResult = await ref
            .read(capturePaymentUseCaseProvider)
            .execute(paymentId: paymentId);

        state = state.copyWith(
          paymentStatus: captureResult['status'] == 'CAPTURED'
              ? 'paid'
              : 'unpaid',
          errorMessage: null,
        );
        fetchPaymentHistory();
        return captureResult['status'] == 'CAPTURED';
      }
    } catch (e) {
      state = state.copyWith(
        paymentStatus: 'unpaid',
        errorMessage: e.toString(),
      );
      return false;
    }
  }

  Future<void> fetchPaymentHistory() async {
    try {
      final payments = await ref
          .read(listPaymentsUseCaseProvider)
          .execute(limit: 20);
      state = state.copyWith(recentPayments: payments);
    } catch (_) {}
  }

  void resetRide() {
    _mapGeneration++;
    state = state.copyWith(
      status: RideStatus.initial,
      currentRide: null,
      clearRide: true,
      clearMapData: true,
      driverName: null,
      vehicleInfo: null,
      errorMessage: null,
      lastDriverLocation: null,
      currentRoute: null,
      userRating: null,
      userReview: null,
      isReviewSubmitted: false,
      paymentStatus: 'unpaid',
      paymentId: null,
      paymentMethod: null,
    );
  }

  RideStatus _mapBackendStatus(model.RideStatus backendStatus) {
    switch (backendStatus) {
      case model.RideStatus.requested:
      case model.RideStatus.searching:
        return RideStatus.searching;
      case model.RideStatus.driverAssigned:
      case model.RideStatus.driverArriving:
        return RideStatus.matched;
      case model.RideStatus.driverArrived:
        return RideStatus.arrived;
      case model.RideStatus.inProgress:
        return RideStatus.active;
      case model.RideStatus.completed:
        return RideStatus.completed;
      case model.RideStatus.cancelled:
        return RideStatus.cancelled;
    }
  }

  @override
  void dispose() {
    _socketStateSubscription?.cancel();
    _eventSubscription?.cancel();
    super.dispose();
  }
}

final rideProvider = StateNotifierProvider<RideNotifier, RideState>((ref) {
  return RideNotifier(ref);
});
