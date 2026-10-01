import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';

import '../../../../core/services/places_autocomplete_service.dart';
import '../../../../shared/widgets/infurnus_empty_state.dart';
import '../../../../shared/widgets/infurnus_skeleton.dart';
import '../../data/models/ride_model.dart' as model;
import '../providers/ride_provider.dart';
import '../widgets/animated_vehicle_hero.dart';
import '../widgets/vehicle_category_visual.dart';
import '../../../auth/presentation/providers/user_provider.dart';

class CustomerHomeScreen extends ConsumerStatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  ConsumerState<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends ConsumerState<CustomerHomeScreen>
    with SingleTickerProviderStateMixin {
  bool _isLoadingHistory = true;
  late AnimationController _animController;
  late Animation<double> _headerFade;
  late Animation<Offset> _headerSlide;
  late Animation<double> _heroFade;
  late Animation<Offset> _heroSlide;
  late Animation<double> _servicesFade;
  late Animation<Offset> _servicesSlide;

  // Search & Autocomplete state
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  Timer? _debounceTimer;
  List<PlaceSuggestion> _suggestions = [];
  bool _isSearching = false;

  // Visual Rule: Light / White background palette
  static const Color mainBg = Color(0xFFF9FAFB);
  static const Color surfaceWhite = Color(0xFFFFFFFF);
  static const Color cardBorder = Color(0xFFE5E7EB);
  static const Color searchBg = Color(0xFFF3F4F6);
  static const Color searchBorder = Color(0xFFE5E7EB);

  // Normal UI: Text & buttons are BLACK / dark
  static const Color textBlack = Color(0xFF111827);
  static const Color textSecondary = Color(0xFF4B5563);
  static const Color textMuted = Color(0xFF9CA3AF);
  static const Color buttonBlack = Color(0xFF111827);

  // Green is strictly reserved for success states, confirmations, and active indicators
  static const Color successGreen = Color(0xFF16A34A);
  static const Color serviceRed = Color(0xFFDC2626);
  static const Color logisticsOrange = Color(0xFFD97706);
  static const Color goldAccent = Color(0xFFCA8A04);

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );

    _headerFade = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.0, 0.4, curve: Curves.easeOut),
    );
    _headerSlide = Tween<Offset>(
      begin: const Offset(0, -0.06),
      end: Offset.zero,
    ).animate(_headerFade);

    _heroFade = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.2, 0.6, curve: Curves.easeOut),
    );
    _heroSlide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(_heroFade);

    _servicesFade = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.4, 0.8, curve: Curves.easeOut),
    );
    _servicesSlide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(_servicesFade);

    _animController.forward();

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(rideProvider.notifier).fetchRideHistory();
      if (mounted) {
        setState(() => _isLoadingHistory = false);
      }
    });
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchController.dispose();
    _searchFocusNode.dispose();
    _animController.dispose();
    super.dispose();
  }

  void _onSearchQueryChanged(String query) {
    _debounceTimer?.cancel();
    if (query.trim().isEmpty) {
      setState(() {
        _suggestions = [];
        _isSearching = false;
      });
      return;
    }

    setState(() => _isSearching = true);

    // Debounce: 200ms for instant autocomplete response
    _debounceTimer = Timer(const Duration(milliseconds: 200), () async {
      final service = ref.read(placesAutocompleteServiceProvider);
      final results = await service.getSuggestions(query);
      if (mounted) {
        setState(() {
          _suggestions = results;
          _isSearching = false;
        });
      }
    });
  }

  void _selectSuggestion(PlaceSuggestion suggestion) {
    _searchFocusNode.unfocus();
    _searchController.clear();
    setState(() => _suggestions = []);

    ref
        .read(rideProvider.notifier)
        .setRoute('Current Location', suggestion.title);

    if (suggestion.latitude != null && suggestion.longitude != null) {
      ref.read(rideProvider.notifier).setDestinationCoords(
            LatLng(suggestion.latitude!, suggestion.longitude!),
            address: suggestion.title,
          );
    }

    context.push('/ride-booking');
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(userProvider);
    final rideState = ref.watch(rideProvider);
    final currentRide = rideState.currentRide;
    final hasActiveTrip =
        currentRide != null &&
        currentRide.status != model.RideStatus.completed &&
        currentRide.status != model.RideStatus.cancelled;

    return Scaffold(
      backgroundColor: mainBg,
      body: SafeArea(
        child: RefreshIndicator(
          color: buttonBlack,
          backgroundColor: surfaceWhite,
          onRefresh: () async {
            setState(() => _isLoadingHistory = true);
            await ref.read(rideProvider.notifier).fetchRideHistory();
            if (mounted) {
              setState(() => _isLoadingHistory = false);
            }
          },
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(
              horizontal: 20.0,
              vertical: 16.0,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Stagger 1: Header (Light Theme)
                SlideTransition(
                  position: _headerSlide,
                  child: FadeTransition(
                    opacity: _headerFade,
                    child: _buildHeader(context, user),
                  ),
                ),
                const SizedBox(height: 20),

                // Stagger 2: Search Bar & Hero Feature Card
                SlideTransition(
                  position: _heroSlide,
                  child: FadeTransition(
                    opacity: _heroFade,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildDestinationSearchBar(context),
                        if (_suggestions.isNotEmpty || _isSearching)
                          _buildAutocompleteDropdown(context),
                        const SizedBox(height: 20),
                        _buildHeroFeatureCard(context),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),

                // Active Trip Banner (if any)
                if (hasActiveTrip) ...[
                  _buildActiveTripBanner(currentRide),
                  const SizedBox(height: 24),
                ],

                // Stagger 3: Services & Recent Activity
                SlideTransition(
                  position: _servicesSlide,
                  child: FadeTransition(
                    opacity: _servicesFade,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Quick Services Direct Grid
                        _buildQuickServicesGrid(context),
                        const SizedBox(height: 28),

                        // Popular Rides / Passenger Fleet
                        _buildPassengerSection(context),
                        const SizedBox(height: 28),

                        // Logistics Section
                        _buildLogisticsSection(context),
                        const SizedBox(height: 28),

                        // Service Fleet Section
                        _buildServiceFleetSection(context),
                        const SizedBox(height: 28),

                        // Luxury Concierge Fleet Section
                        _buildConciergeFleetSection(context),
                        const SizedBox(height: 32),

                        // Recent Activity Timeline Section
                        _buildRecentActivitySection(context, rideState),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: _buildBottomNavigationBar(context),
    );
  }

  Widget _buildHeader(BuildContext context, dynamic user) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'NAMASTE',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w900,
                letterSpacing: 2.0,
                color: textSecondary,
              ),
            ),
            const SizedBox(height: 2),
            Row(
              children: [
                const Text(
                  'INFURNUS',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.5,
                    color: textBlack,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '👋 ${user?.firstName ?? "User"}',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: textSecondary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            const Text(
              'Move. Haul. Rise.',
              style: TextStyle(
                fontSize: 12,
                color: textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        Row(
          children: [
            _buildHeaderIcon(
              icon: Icons.chat_bubble_outline_rounded,
              tooltip: 'AI Assistant',
              showBadge: true,
              onTap: () => context.push('/ai-assistant/customer'),
            ),
            const SizedBox(width: 10),
            _buildHeaderIcon(
              icon: Icons.person_outline_rounded,
              tooltip: 'Profile',
              onTap: () => context.push('/profile'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildHeaderIcon({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
    bool showBadge = false,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Stack(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: surfaceWhite,
              shape: BoxShape.circle,
              border: Border.all(color: cardBorder),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Icon(icon, size: 20, color: textBlack),
          ),
          if (showBadge)
            Positioned(
              right: 2,
              top: 2,
              child: Container(
                width: 9,
                height: 9,
                decoration: const BoxDecoration(
                  color: successGreen,
                  shape: BoxShape.circle,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDestinationSearchBar(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: surfaceWhite,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: searchBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        children: [
          const SizedBox(width: 16),
          const Icon(
            Icons.search_rounded,
            color: textBlack,
            size: 22,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _searchController,
              focusNode: _searchFocusNode,
              onChanged: _onSearchQueryChanged,
              style: const TextStyle(
                color: textBlack,
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
              decoration: const InputDecoration(
                hintText: 'Search',
                hintStyle: TextStyle(
                  color: textMuted,
                  fontSize: 15,
                  fontWeight: FontWeight.w400,
                ),
                border: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 14),
              ),
              onSubmitted: (val) {
                if (val.trim().isNotEmpty) {
                  ref
                      .read(rideProvider.notifier)
                      .setRoute('Current Location', val.trim());
                  context.push('/ride-booking');
                }
              },
            ),
          ),
          if (_searchController.text.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.close_rounded, size: 18, color: textMuted),
              onPressed: () {
                _searchController.clear();
                _onSearchQueryChanged('');
              },
            ),
          Container(
            margin: const EdgeInsets.only(right: 8),
            padding: const EdgeInsets.all(8),
            decoration: const BoxDecoration(
              color: buttonBlack,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.arrow_forward_rounded,
              color: Colors.white,
              size: 16,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAutocompleteDropdown(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: surfaceWhite,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: cardBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_isSearching)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: buttonBlack,
                ),
              ),
            )
          else if (_suggestions.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  Icon(Icons.info_outline_rounded, size: 16, color: textMuted),
                  SizedBox(width: 8),
                  Text(
                    'No locations found. Press enter to search.',
                    style: TextStyle(fontSize: 13, color: textMuted),
                  ),
                ],
              ),
            )
          else
            ...List.generate(_suggestions.length, (index) {
              final suggestion = _suggestions[index];
              return InkWell(
                onTap: () => _selectSuggestion(suggestion),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: searchBg,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.location_on_outlined,
                          size: 16,
                          color: buttonBlack,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              suggestion.title,
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                                color: textBlack,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 2),
                            Text(
                              suggestion.subtitle,
                              style: const TextStyle(
                                fontSize: 12,
                                color: textSecondary,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      const Icon(
                        Icons.north_west_rounded,
                        size: 14,
                        color: textMuted,
                      ),
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildHeroFeatureCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1E3A8A), Color(0xFF2563EB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF1E3A8A).withValues(alpha: 0.25),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'ONE APP • EVERY WHEEL',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.5,
                          color: Color(0xFFBFDBFE),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'From auto to\nhelicopter',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () {
                        ref
                            .read(rideProvider.notifier)
                            .selectSector('passenger');
                        context.push('/ride-booking');
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: buttonBlack,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 10,
                        ),
                        elevation: 0,
                      ),
                      child: const Text(
                        'Explore fleet →',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              // Dedicated Animated Vehicle Element Container
              const AnimatedVehicleHero(
                height: 100,
                assetImagePath: 'assets/images/infurnus_3d_logo.png',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildQuickServicesGrid(BuildContext context) {
    final services = [
      {
        'title': 'Rides',
        'subtitle': 'Bike, Auto, Cab',
        'category': VehicleCategoryType.rides,
        'action': () {
          ref.read(rideProvider.notifier).selectSector('passenger');
          context.push('/ride-booking');
        },
      },
      {
        'title': 'Logistics',
        'subtitle': 'Parcels & Trucks',
        'category': VehicleCategoryType.logistics,
        'action': () => context.push('/logistics'),
      },
      {
        'title': 'Emergency',
        'subtitle': 'Ambulance & Tow',
        'category': VehicleCategoryType.emergency,
        'action': () {
          ref.read(rideProvider.notifier).selectSector('service');
          context.push('/ride-booking');
        },
      },
      {
        'title': 'Rentals',
        'subtitle': 'Luxury & Chauffeur',
        'category': VehicleCategoryType.rental,
        'action': () => context.push('/rentals'),
      },
    ];

    return GridView.builder(
      physics: const NeverScrollableScrollPhysics(),
      shrinkWrap: true,
      itemCount: services.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 2.2,
      ),
      itemBuilder: (context, index) {
        final item = services[index];
        final category = item['category'] as VehicleCategoryType;
        return _PressableScaleCard(
          onTap: item['action'] as VoidCallback,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: surfaceWhite,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: cardBorder),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                VehicleCategoryVisual(
                  category: category,
                  size: 38,
                  borderRadius: 10,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        item['title'] as String,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: textBlack,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item['subtitle'] as String,
                        style: const TextStyle(
                          fontSize: 11,
                          color: textSecondary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildPassengerSection(BuildContext context) {
    final items = const [
      _VehicleCategoryItem(
        title: 'Bike',
        capacity: '1 rider',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.two_wheeler_rounded,
        category: VehicleCategoryType.bike,
      ),
      _VehicleCategoryItem(
        title: 'Auto',
        capacity: '3 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.electric_rickshaw_rounded,
        category: VehicleCategoryType.auto,
      ),
      _VehicleCategoryItem(
        title: 'Mini / Compact',
        capacity: '4 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.directions_car_rounded,
        category: VehicleCategoryType.rides,
      ),
      _VehicleCategoryItem(
        title: 'Sedan',
        capacity: '4 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.airport_shuttle_rounded,
        category: VehicleCategoryType.rides,
      ),
      _VehicleCategoryItem(
        title: 'SUV',
        capacity: '6 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.directions_car_filled_rounded,
        category: VehicleCategoryType.premium,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader(
          title: 'Passenger Rides',
          subtitle: 'Everyday rides across the city',
          onSeeAll: () {
            ref.read(rideProvider.notifier).selectSector('passenger');
            context.push('/ride-booking');
          },
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 145,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return _buildHorizontalVehicleCard(
                item: item,
                onTap: () {
                  ref.read(rideProvider.notifier).selectSector('passenger');
                  context.push('/ride-booking');
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildLogisticsSection(BuildContext context) {
    final items = const [
      _VehicleCategoryItem(
        title: 'Bike Express',
        capacity: 'Up to 20 kg',
        rate: 'Server Rate',
        eta: 'On-demand',
        icon: Icons.two_wheeler_rounded,
        category: VehicleCategoryType.bike,
      ),
      _VehicleCategoryItem(
        title: '3-Wheeler',
        capacity: 'Up to 300 kg',
        rate: 'Server Rate',
        eta: 'On-demand',
        icon: Icons.electric_rickshaw_rounded,
        category: VehicleCategoryType.auto,
      ),
      _VehicleCategoryItem(
        title: 'Mini Truck 1T',
        capacity: 'Up to 1000 kg',
        rate: 'Server Rate',
        eta: 'On-demand',
        icon: Icons.local_shipping_rounded,
        category: VehicleCategoryType.logistics,
      ),
      _VehicleCategoryItem(
        title: 'Tata 407',
        capacity: 'Up to 2500 kg',
        rate: 'Server Rate',
        eta: 'On-demand',
        icon: Icons.directions_bus_outlined,
        category: VehicleCategoryType.logistics,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader(
          title: 'Logistics',
          subtitle: 'Move goods with muscle',
          onSeeAll: () => context.push('/logistics'),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 145,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return _buildHorizontalVehicleCard(
                item: item,
                onTap: () => context.push('/logistics'),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildServiceFleetSection(BuildContext context) {
    final items = const [
      _VehicleCategoryItem(
        title: 'Ambulance',
        capacity: 'Patient + Medical Triage',
        rate: 'Trip-Based',
        eta: 'Priority',
        icon: Icons.medical_services_rounded,
        category: VehicleCategoryType.emergency,
      ),
      _VehicleCategoryItem(
        title: 'Towing Van',
        capacity: 'Breakdown Assist',
        rate: 'Trip-Based',
        eta: 'Priority',
        icon: Icons.car_repair_rounded,
        category: VehicleCategoryType.emergency,
      ),
      _VehicleCategoryItem(
        title: 'JCB / Excavator',
        capacity: 'Specialty Excavation',
        rate: 'Trip-Based',
        eta: 'Scheduled',
        icon: Icons.agriculture_rounded,
        category: VehicleCategoryType.logistics,
      ),
      _VehicleCategoryItem(
        title: 'Roadside Assist',
        capacity: 'Tire / Battery Support',
        rate: 'Trip-Based',
        eta: 'Priority',
        icon: Icons.build_rounded,
        category: VehicleCategoryType.emergency,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader(
          title: 'Specialty & Emergency',
          subtitle: 'On-demand specialized fleet support',
          onSeeAll: () {
            ref.read(rideProvider.notifier).selectSector('service');
            context.push('/ride-booking');
          },
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 145,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return _buildHorizontalVehicleCard(
                item: item,
                onTap: () {
                  ref.read(rideProvider.notifier).selectSector('service');
                  context.push('/ride-booking');
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildConciergeFleetSection(BuildContext context) {
    final luxuryVehicles = const [
      _LuxuryVehicleItem(
        title: 'Mahindra Thar',
        badge: 'Off-road',
        subtitle: 'Iconic 4x4 legend',
        price: 'Chauffeur + Fuel',
        assetImagePath: 'assets/images/thar_visual.webp',
      ),
      _LuxuryVehicleItem(
        title: 'Toyota Fortuner',
        badge: 'Executive',
        subtitle: 'Commanding presence',
        price: 'Chauffeur + Fuel',
        assetImagePath: 'assets/images/fortuner_visual.jpg',
      ),
      _LuxuryVehicleItem(
        title: 'BMW / Mercedes SUV',
        badge: 'VIP Luxury',
        subtitle: 'Flagship luxury suite',
        price: 'Chauffeur + Fuel',
        assetImagePath: 'assets/images/bmw_visual.webp',
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF9C3),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: const Color(0xFFFDE047),
                    ),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('👑 ', style: TextStyle(fontSize: 10)),
                      Text(
                        'PREMIUM',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                          color: goldAccent,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'The Concierge Fleet',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: textBlack,
                  ),
                ),
                const Text(
                  'Luxury on-demand • Sky, road, off-road',
                  style: TextStyle(fontSize: 12, color: textSecondary),
                ),
              ],
            ),
            GestureDetector(
              onTap: () => context.push('/rentals'),
              child: const Text(
                'See all →',
                style: TextStyle(
                  color: textBlack,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Column(
          children: luxuryVehicles
              .map(
                (item) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _buildLuxuryVehicleCard(context, item),
                ),
              )
              .toList(),
        ),
      ],
    );
  }

  Widget _buildLuxuryVehicleCard(
    BuildContext context,
    _LuxuryVehicleItem item,
  ) {
    return _PressableScaleCard(
      onTap: () => context.push('/rentals'),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: surfaceWhite,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: cardBorder),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: 52,
                height: 52,
                color: searchBg,
                child: item.assetImagePath != null
                    ? Image.asset(
                        item.assetImagePath!,
                        width: 52,
                        height: 52,
                        fit: BoxFit.cover,
                      )
                    : const VehicleCategoryVisual(
                        category: VehicleCategoryType.premium,
                        size: 52,
                        borderRadius: 12,
                      ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: searchBg,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      item.badge,
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: textBlack,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    item.title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: textBlack,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.subtitle,
                    style: const TextStyle(fontSize: 12, color: textSecondary),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    item.price,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: textBlack,
                    ),
                  ),
                ],
              ),
            ),
            ElevatedButton(
              onPressed: () => context.push('/rentals'),
              style: ElevatedButton.styleFrom(
                backgroundColor: buttonBlack,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                elevation: 0,
              ),
              child: const Text(
                'Book →',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader({
    required String title,
    required String subtitle,
    required VoidCallback onSeeAll,
  }) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w900,
                color: textBlack,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(fontSize: 12, color: textSecondary),
            ),
          ],
        ),
        GestureDetector(
          onTap: onSeeAll,
          child: const Text(
            'See all ↗',
            style: TextStyle(
              color: textBlack,
              fontWeight: FontWeight.bold,
              fontSize: 13,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildHorizontalVehicleCard({
    required _VehicleCategoryItem item,
    required VoidCallback onTap,
  }) {
    return _PressableScaleCard(
      onTap: onTap,
      child: Container(
        width: 140,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: surfaceWhite,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: cardBorder),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            VehicleCategoryVisual(
              category: item.category,
              size: 40,
              borderRadius: 10,
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: textBlack,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  item.capacity,
                  style: const TextStyle(fontSize: 11, color: textSecondary),
                ),
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      item.rate,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 10,
                        color: textBlack,
                      ),
                    ),
                    Text(
                      item.eta,
                      style: const TextStyle(fontSize: 10, color: textSecondary),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveTripBanner(model.RideModel currentRide) {
    return GestureDetector(
      onTap: () => context.push('/ride-booking'),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: surfaceWhite,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: successGreen.withValues(alpha: 0.5)),
          boxShadow: [
            BoxShadow(
              color: successGreen.withValues(alpha: 0.1),
              blurRadius: 14,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: successGreen.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.navigation_rounded,
                color: successGreen,
                size: 24,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: successGreen,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          'ACTIVE TRIP',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _formatStatus(currentRide.status),
                        style: const TextStyle(
                          color: textSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    currentRide.destinationAddress ?? 'Heading to Destination',
                    style: const TextStyle(
                      color: textBlack,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.arrow_forward_ios_rounded,
              color: textBlack,
              size: 16,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRecentActivitySection(BuildContext context, dynamic rideState) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Recent Activity',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: textBlack,
              ),
            ),
            if (rideState.history.isNotEmpty)
              GestureDetector(
                onTap: () => context.push('/booking-history'),
                child: const Text(
                  'View All →',
                  style: TextStyle(
                    color: textBlack,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        if (_isLoadingHistory && rideState.history.isEmpty) ...[
          const InfurnusSkeletonCard(),
          const InfurnusSkeletonCard(),
        ] else if (rideState.history.isNotEmpty)
          ...rideState.history.take(3).map((ride) => _buildActivityCard(ride))
        else
          InfurnusEmptyState(
            icon: Icons.route_outlined,
            title: 'No trips yet',
            description:
                'Your completed rides and deliveries will appear here.',
            actionLabel: 'Book a Ride',
            onAction: () {
              ref.read(rideProvider.notifier).selectSector('passenger');
              context.push('/ride-booking');
            },
          ),
      ],
    );
  }

  Widget _buildActivityCard(model.RideModel ride) {
    final formattedDate = DateFormat('MMM d, h:mm a').format(ride.createdAt);
    final isCancelled = ride.status == model.RideStatus.cancelled;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: surfaceWhite,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: cardBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () {
            ref.read(rideProvider.notifier).getRideDetails(ride.id);
            context.push('/ride-booking');
          },
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: isCancelled
                        ? serviceRed.withValues(alpha: 0.12)
                        : searchBg,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    ride.sector == 'logistics'
                        ? Icons.local_shipping_rounded
                        : (ride.sector == 'service'
                            ? Icons.emergency_rounded
                            : (ride.sector == 'premium'
                                ? Icons.stars_rounded
                                : Icons.directions_car_rounded)),
                    color: isCancelled ? serviceRed : buttonBlack,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        ride.destinationAddress ?? 'Ride destination',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: textBlack,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: isCancelled
                                  ? serviceRed.withValues(alpha: 0.1)
                                  : (ride.status == model.RideStatus.completed
                                      ? successGreen.withValues(alpha: 0.15)
                                      : searchBg),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              _formatStatus(ride.status).toUpperCase(),
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                                color: isCancelled
                                    ? serviceRed
                                    : (ride.status == model.RideStatus.completed
                                        ? successGreen
                                        : textBlack),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            formattedDate,
                            style: const TextStyle(
                              color: textSecondary,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (!isCancelled && ride.displayFare > 0) ...[
                  const SizedBox(width: 8),
                  Text(
                    '₹${ride.displayFare.toStringAsFixed(0)}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                      color: textBlack,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBottomNavigationBar(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: surfaceWhite,
        border: Border(top: BorderSide(color: cardBorder, width: 1.0)),
      ),
      child: BottomNavigationBar(
        selectedItemColor: buttonBlack,
        unselectedItemColor: textMuted,
        currentIndex: 0,
        type: BottomNavigationBarType.fixed,
        backgroundColor: surfaceWhite,
        elevation: 0,
        showSelectedLabels: true,
        showUnselectedLabels: true,
        selectedFontSize: 11,
        unselectedFontSize: 11,
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold),
        onTap: (index) {
          if (index == 1) context.push('/booking-history');
          if (index == 2) context.push('/wallet');
          if (index == 3) context.push('/profile');
        },
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.home_filled),
            label: 'Home',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.local_activity_outlined),
            activeIcon: Icon(Icons.local_activity_rounded),
            label: 'Activity',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.account_balance_wallet_outlined),
            activeIcon: Icon(Icons.account_balance_wallet_rounded),
            label: 'Wallet',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person_outline_rounded),
            activeIcon: Icon(Icons.person_rounded),
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  String _formatStatus(model.RideStatus status) {
    switch (status) {
      case model.RideStatus.requested:
        return 'Requested';
      case model.RideStatus.searching:
        return 'Searching';
      case model.RideStatus.driverAssigned:
        return 'Driver Assigned';
      case model.RideStatus.driverArriving:
        return 'Driver Arriving';
      case model.RideStatus.driverArrived:
        return 'Driver Arrived';
      case model.RideStatus.inProgress:
        return 'In Progress';
      case model.RideStatus.completed:
        return 'Completed';
      case model.RideStatus.cancelled:
        return 'Cancelled';
    }
  }
}

class _VehicleCategoryItem {
  final String title;
  final String capacity;
  final String rate;
  final String eta;
  final IconData icon;
  final VehicleCategoryType category;

  const _VehicleCategoryItem({
    required this.title,
    required this.capacity,
    required this.rate,
    required this.eta,
    required this.icon,
    required this.category,
  });
}

class _LuxuryVehicleItem {
  final String title;
  final String badge;
  final String subtitle;
  final String price;
  final String? assetImagePath;

  const _LuxuryVehicleItem({
    required this.title,
    required this.badge,
    required this.subtitle,
    required this.price,
    this.assetImagePath,
  });
}

class _PressableScaleCard extends StatefulWidget {
  final Widget child;
  final VoidCallback onTap;

  const _PressableScaleCard({required this.child, required this.onTap});

  @override
  State<_PressableScaleCard> createState() => _PressableScaleCardState();
}

class _PressableScaleCardState extends State<_PressableScaleCard> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    return AnimatedScale(
      scale: _isPressed ? 0.97 : 1.0,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeInOut,
      child: GestureDetector(
        onTap: widget.onTap,
        onTapDown: (_) => setState(() => _isPressed = true),
        onTapUp: (_) => setState(() => _isPressed = false),
        onTapCancel: () => setState(() => _isPressed = false),
        child: widget.child,
      ),
    );
  }
}
