import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../../core/services/geocoding_service.dart';
import '../../../../core/services/location_service.dart';
import '../../../../core/services/places_autocomplete_service.dart';
import '../providers/ride_provider.dart';

/// Screen 2 in the reference booking flow:
/// Allows selecting Pickup and Destination locations with live autocomplete,
/// recent locations, GPS auto-detect, and clear error banners when location is missing.
class PickupSelectionScreen extends ConsumerStatefulWidget {
  final String? initialSector;

  const PickupSelectionScreen({super.key, this.initialSector});

  @override
  ConsumerState<PickupSelectionScreen> createState() =>
      _PickupSelectionScreenState();
}

class _PickupSelectionScreenState extends ConsumerState<PickupSelectionScreen> {
  final TextEditingController _pickupController = TextEditingController();
  final TextEditingController _destinationController = TextEditingController();
  final FocusNode _pickupFocusNode = FocusNode();
  final FocusNode _destinationFocusNode = FocusNode();

  bool _isLocationFound = false;
  bool _isDetectingLocation = false;
  bool _isPickupActive = true;

  Timer? _debounceTimer;
  CancelToken? _cancelToken;
  List<PlaceSuggestion> _suggestions = [];
  bool _isLoadingSuggestions = false;
  String? _searchError;

  // Recent places list matching reference screenshot 2
  final List<Map<String, dynamic>> _recentPlaces = [
    {
      'title': 'Patna Junction',
      'subtitle': 'Fraser Road Area, Patna, Bihar, India',
      'coords': const LatLng(25.6027, 85.1376),
    },
    {
      'title': 'Vaibhav Khand',
      'subtitle': 'Vaibhav Khand, Gomti Nagar, Lucknow, Uttar Pradesh, India',
      'coords': const LatLng(26.8528, 81.0028),
    },
    {
      'title': 'Staff Training Center Union Bank Of India',
      'subtitle':
          'Mantri Awas Marg, Vibhuti Khand, Gomti Nagar, Lucknow, India',
      'coords': const LatLng(26.8687, 81.0123),
    },
    {
      'title': 'Panchmukhi Hanuman Mandir',
      'subtitle':
          'yogveer matth, Gandhi Nagar, Kankarbagh, Patna, Bihar, India',
      'coords': const LatLng(25.5941, 85.1564),
    },
  ];

  @override
  void initState() {
    super.initState();
    final rideState = ref.read(rideProvider);

    // Preserve or set sector if passed
    if (widget.initialSector != null && widget.initialSector!.isNotEmpty) {
      if (rideState.selectedSector != widget.initialSector) {
        ref.read(rideProvider.notifier).selectSector(widget.initialSector!);
      }
    }

    if (rideState.pickup != null && rideState.pickup!.isNotEmpty) {
      _pickupController.text = rideState.pickup!;
      _isLocationFound = rideState.pickupCoords != null;
    }
    if (rideState.destination != null && rideState.destination!.isNotEmpty) {
      _destinationController.text = rideState.destination!;
    }

    _pickupFocusNode.addListener(() {
      if (_pickupFocusNode.hasFocus) {
        setState(() {
          _isPickupActive = true;
          _suggestions = [];
        });
      }
    });

    _destinationFocusNode.addListener(() {
      if (_destinationFocusNode.hasFocus) {
        setState(() {
          _isPickupActive = false;
          _suggestions = [];
        });
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initLocation();
    });
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _cancelToken?.cancel();
    _pickupController.dispose();
    _destinationController.dispose();
    _pickupFocusNode.dispose();
    _destinationFocusNode.dispose();
    super.dispose();
  }

  Future<void> _initLocation() async {
    final rideState = ref.read(rideProvider);
    if (rideState.pickupCoords != null &&
        rideState.pickup != null &&
        rideState.pickup!.trim().isNotEmpty &&
        rideState.pickup!.toLowerCase() != 'current location') {
      setState(() {
        _isLocationFound = true;
      });
      if (_destinationController.text.trim().isEmpty) {
        _destinationFocusNode.requestFocus();
      }
      return;
    }

    setState(() => _isDetectingLocation = true);

    try {
      final pos = await ref.read(locationServiceProvider).getCurrentPosition();
      if (!mounted) return;
      if (pos != null) {
        final coords = LatLng(pos.latitude, pos.longitude);
        final address = await ref
            .read(geocodingServiceProvider)
            .reverseGeocode(coords);
        if (!mounted) return;
        final resolvedText = address ?? 'Current Location';
        _pickupController.text = resolvedText;
        ref
            .read(rideProvider.notifier)
            .setPickupCoords(coords, address: resolvedText);
        setState(() {
          _isLocationFound = true;
          _isDetectingLocation = false;
        });
        if (_destinationController.text.trim().isEmpty) {
          _destinationFocusNode.requestFocus();
        }
      } else {
        setState(() {
          _isLocationFound = false;
          _isDetectingLocation = false;
        });
        _pickupFocusNode.requestFocus();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isLocationFound = false;
        _isDetectingLocation = false;
      });
      _pickupFocusNode.requestFocus();
    }
  }

  void _onQueryChanged(String query) {
    _debounceTimer?.cancel();
    _cancelToken?.cancel();

    final trimmed = query.trim();
    if (trimmed.length < 2) {
      setState(() {
        _suggestions = [];
        _searchError = null;
        _isLoadingSuggestions = false;
      });
      return;
    }

    setState(() => _isLoadingSuggestions = true);

    _debounceTimer = Timer(const Duration(milliseconds: 250), () async {
      _cancelToken = CancelToken();
      try {
        final results = await ref
            .read(placesAutocompleteServiceProvider)
            .getSuggestions(trimmed, cancelToken: _cancelToken);
        if (!mounted || (_cancelToken?.isCancelled ?? false)) return;
        setState(() {
          _suggestions = results;
          _searchError = null;
          _isLoadingSuggestions = false;
        });
      } catch (e) {
        if (!mounted || (_cancelToken?.isCancelled ?? false)) return;
        setState(() {
          _searchError = locationSearchErrorMessage(e);
          _suggestions = [];
          _isLoadingSuggestions = false;
        });
      }
    });
  }

  Future<void> _selectPlace(
    String title,
    String subtitle, {
    LatLng? directCoords,
  }) async {
    final fullAddress = subtitle.isNotEmpty ? '$title, $subtitle' : title;
    final isPickup = _isPickupActive;

    if (isPickup) {
      _pickupController.text = title;
      setState(() {
        _isLocationFound = true;
      });
    } else {
      _destinationController.text = title;
    }

    LatLng? coords = directCoords;
    if (coords == null) {
      try {
        coords = await ref
            .read(geocodingServiceProvider)
            .geocodeAddress(fullAddress);
      } catch (_) {}
    }

    if (!mounted) return;

    if (coords != null) {
      if (isPickup) {
        ref
            .read(rideProvider.notifier)
            .setPickupCoords(coords, address: fullAddress);
      } else {
        ref
            .read(rideProvider.notifier)
            .setDestinationCoords(coords, address: fullAddress);
      }
    }

    setState(() {
      _suggestions = [];
    });

    _checkAndAdvance();
  }

  void _checkAndAdvance() {
    final rideState = ref.read(rideProvider);
    final hasPickup =
        _pickupController.text.trim().isNotEmpty &&
        rideState.pickupCoords != null;
    final hasDest =
        _destinationController.text.trim().isNotEmpty &&
        rideState.destinationCoords != null;

    if (hasPickup && hasDest) {
      if (rideState.selectedTier.trim().isEmpty) {
        ref.read(rideProvider.notifier).selectTier('hatchback');
      }
      // Calculate fare and advance to vehicle selection screen
      ref.read(rideProvider.notifier).estimateRouteFare();
      context.push('/ride-booking');
    } else if (hasPickup && !hasDest) {
      _destinationFocusNode.requestFocus();
    } else if (!hasPickup && hasDest) {
      _pickupFocusNode.requestFocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final rideState = ref.watch(rideProvider);
    final sector = rideState.selectedSector;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: Color(0xFF111827)),
          onPressed: () => context.pop(),
        ),
        title: Text(
          _isPickupActive ? 'Pickup' : 'Where to?',
          style: const TextStyle(
            color: Color(0xFF111827),
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        centerTitle: false,
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFE5E7EB)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _getSectorDisplayPill(sector),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF111827),
                  ),
                ),
                const SizedBox(width: 4),
                const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 16,
                  color: Color(0xFF4B5563),
                ),
              ],
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Warning Banner: "Uh oh, we can't find you!"
            if (!_isLocationFound && !_isDetectingLocation)
              _buildLocationWarningBanner(),

            // Route Inputs Card
            _buildRouteInputsCard(),

            // Quick Action Buttons: "Select on map", "Add stops"
            _buildActionPills(),

            const SizedBox(height: 8),
            const Divider(height: 1, color: Color(0xFFF3F4F6)),

            // Autocomplete Results or Recent Locations List
            Expanded(
              child: _suggestions.isNotEmpty
                  ? _buildSuggestionsList()
                  : _buildRecentPlacesList(),
            ),
          ],
        ),
      ),
    );
  }

  String _getSectorDisplayPill(String sector) {
    switch (sector) {
      case 'logistics':
        return 'For Logistics';
      case 'service':
        return 'For Emergency';
      case 'premium':
        return 'For Rentals';
      case 'passenger':
      default:
        return 'For me';
    }
  }

  Widget _buildLocationWarningBanner() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1F2), // Light peach/pink background
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFECDD3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(4),
            decoration: const BoxDecoration(
              color: Color(0xFF374151), // Dark circular info icon background
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.info_outline_rounded,
              size: 14,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              "Uh oh, we can't find you! Enter your pickup location for a smooth ride.",
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1F2937),
                height: 1.3,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteInputsCard() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        children: [
          // Pickup Row
          Row(
            children: [
              // Green circle dot
              Container(
                width: 14,
                height: 14,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: const Color(0xFF10B981),
                    width: 3.5,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _pickupController,
                  focusNode: _pickupFocusNode,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF111827),
                  ),
                  decoration: const InputDecoration(
                    hintText: 'Pickup location',
                    hintStyle: TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                  ),
                  onChanged: (val) {
                    setState(() {
                      if (val.trim().isNotEmpty) {
                        _isLocationFound = true;
                      }
                    });
                    _onQueryChanged(val);
                  },
                ),
              ),
              if (_pickupController.text.isNotEmpty)
                GestureDetector(
                  onTap: () {
                    _pickupController.clear();
                    setState(() {
                      _isLocationFound = false;
                      _suggestions = [];
                    });
                    _pickupFocusNode.requestFocus();
                  },
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(
                      Icons.cancel_rounded,
                      size: 18,
                      color: Color(0xFF9CA3AF),
                    ),
                  ),
                ),
            ],
          ),

          // Connecting vertical dashed line
          Padding(
            padding: const EdgeInsets.only(left: 6, top: 4, bottom: 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Container(
                width: 2,
                height: 22,
                color: const Color(0xFFD1D5DB),
              ),
            ),
          ),

          // Destination Row
          Row(
            children: [
              // Orange / amber circle dot
              Container(
                width: 14,
                height: 14,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: const Color(0xFFF97316),
                    width: 3.5,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _destinationController,
                  focusNode: _destinationFocusNode,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF111827),
                  ),
                  decoration: const InputDecoration(
                    hintText: 'Enter destination',
                    hintStyle: TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                  ),
                  onChanged: _onQueryChanged,
                ),
              ),
              if (_destinationController.text.isNotEmpty)
                GestureDetector(
                  onTap: () {
                    _destinationController.clear();
                    setState(() => _suggestions = []);
                    _destinationFocusNode.requestFocus();
                  },
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(
                      Icons.cancel_rounded,
                      size: 18,
                      color: Color(0xFF9CA3AF),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActionPills() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                // If pickup is missing, detect GPS or use default city center
                _initLocation();
              },
              icon: const Icon(
                Icons.location_on_outlined,
                size: 18,
                color: Color(0xFF111827),
              ),
              label: const Text(
                'Select on map',
                style: TextStyle(
                  color: Color(0xFF111827),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              style: OutlinedButton.styleFrom(
                backgroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 10),
                side: const BorderSide(color: Color(0xFFE5E7EB)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Multi-stop booking will be available soon!'),
                    duration: Duration(seconds: 2),
                  ),
                );
              },
              icon: const Icon(
                Icons.add_rounded,
                size: 18,
                color: Color(0xFF111827),
              ),
              label: const Text(
                'Add stops',
                style: TextStyle(
                  color: Color(0xFF111827),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              style: OutlinedButton.styleFrom(
                backgroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 10),
                side: const BorderSide(color: Color(0xFFE5E7EB)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSuggestionsList() {
    if (_isLoadingSuggestions) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24.0),
          child: CircularProgressIndicator(color: Color(0xFF16A34A)),
        ),
      );
    }

    if (_searchError != null) {
      return Padding(
        padding: const EdgeInsets.all(24.0),
        child: Center(
          child: Text(
            _searchError!,
            style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: _suggestions.length,
      separatorBuilder: (_, __) =>
          const Divider(height: 1, indent: 56, color: Color(0xFFF3F4F6)),
      itemBuilder: (context, index) {
        final suggestion = _suggestions[index];
        final latLng =
            suggestion.latitude != null && suggestion.longitude != null
            ? LatLng(suggestion.latitude!, suggestion.longitude!)
            : null;

        return ListTile(
          leading: const Icon(
            Icons.location_on_rounded,
            color: Color(0xFF6B7280),
            size: 22,
          ),
          title: Text(
            suggestion.title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Color(0xFF111827),
            ),
          ),
          subtitle: suggestion.subtitle.isNotEmpty
              ? Text(
                  suggestion.subtitle,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF6B7280),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                )
              : null,
          onTap: () => _selectPlace(
            suggestion.title,
            suggestion.subtitle,
            directCoords: latLng,
          ),
        );
      },
    );
  }

  Widget _buildRecentPlacesList() {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: _recentPlaces.length,
      separatorBuilder: (_, __) =>
          const Divider(height: 1, indent: 56, color: Color(0xFFF3F4F6)),
      itemBuilder: (context, index) {
        final place = _recentPlaces[index];
        return ListTile(
          leading: const Icon(
            Icons.history_rounded,
            color: Color(0xFF6B7280),
            size: 22,
          ),
          title: Text(
            place['title'] as String,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Color(0xFF111827),
            ),
          ),
          subtitle: Text(
            place['subtitle'] as String,
            style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: const Icon(
            Icons.favorite_border_rounded,
            color: Color(0xFF9CA3AF),
            size: 20,
          ),
          onTap: () => _selectPlace(
            place['title'] as String,
            place['subtitle'] as String,
            directCoords: place['coords'] as LatLng?,
          ),
        );
      },
    );
  }
}
