import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';

import '../../../../core/services/places_autocomplete_service.dart';
import '../../../../core/services/geocoding_service.dart';
import '../../../../shared/widgets/infurnus_skeleton.dart';
import '../../data/models/ride_model.dart' as model;
import '../providers/ride_provider.dart';
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
  CancelToken? _searchCancelToken;
  List<PlaceSuggestion> _suggestions = [];

  // ── PREMIUM DESIGN SYSTEM ──────────────────────────────────────────────────
  // Dark rich backgrounds
  // ── CLEAN WHITE DESIGN SYSTEM ─────────────────────────────────────────────
  // Clean White / Light backgrounds
  static const Color bgDeep   = Color(0xFFF8FAFC); // clean light canvas
  static const Color bgCard   = Color(0xFFFFFFFF); // crisp white cards
  static const Color bgSurface= Color(0xFFF1F5F9); // soft light grey image well

  // Borders & dividers
  static const Color borderDim  = Color(0xFFE2E8F0); // subtle border

  // Text
  static const Color textWhite   = Color(0xFF0F172A); // dark slate primary text
  static const Color textSilver  = Color(0xFF475569); // slate secondary text
  static const Color textMuted   = Color(0xFF94A3B8); // muted grey text

  // Brand green (primary CTA)
  static const Color brandGreen  = Color(0xFF22C55E);
  static const Color brandGreenDark = Color(0xFF16A34A);
  static const Color brandGreenGlow = Color(0x3322C55E);

  // Service category accent colours
  static const Color accentRide  = Color(0xFF3B82F6); // blue
  static const Color accentLogis = Color(0xFFF59E0B); // amber
  static const Color accentEmerg = Color(0xFFEF4444); // red
  static const Color accentRent  = Color(0xFFA855F7); // purple

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
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
      curve: const Interval(0.4, 0.85, curve: Curves.easeOut),
    );
    _servicesSlide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(_servicesFade);

    _animController.forward();

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(rideProvider.notifier).fetchRideHistory();
      if (mounted) setState(() => _isLoadingHistory = false);
    });
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchCancelToken?.cancel();
    _searchController.dispose();
    _searchFocusNode.dispose();
    _animController.dispose();
    super.dispose();
  }

  Future<void> _selectSuggestion(PlaceSuggestion suggestion) async {
    LatLng? coordinates;
    try {
      coordinates = suggestion.latitude != null && suggestion.longitude != null
          ? LatLng(suggestion.latitude!, suggestion.longitude!)
          : await ref
                .read(geocodingServiceProvider)
                .geocodeAddress(suggestion.toString());
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Location lookup unavailable. Please retry.')),
        );
      }
      return;
    }
    if (!mounted || coordinates == null) return;
    _debounceTimer?.cancel();
    _searchCancelToken?.cancel();
    _searchFocusNode.unfocus();
    _searchController.clear();
    setState(() => _suggestions = []);
    ref.read(rideProvider.notifier).setRoute('Current Location', suggestion.title);
    ref.read(rideProvider.notifier).setDestinationCoords(coordinates, address: suggestion.toString());
    context.push('/ride-booking');
  }

  @override
  Widget build(BuildContext context) {
    final user      = ref.watch(userProvider);
    final rideState = ref.watch(rideProvider);
    final currentRide = rideState.currentRide;
    final hasActiveTrip =
        currentRide != null &&
        currentRide.status != model.RideStatus.completed &&
        currentRide.status != model.RideStatus.cancelled;

    return Scaffold(
      backgroundColor: bgDeep,
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          // ── RICH DARK HEADER ──────────────────────────────────────────────
          SliverToBoxAdapter(
            child: SlideTransition(
              position: _headerSlide,
              child: FadeTransition(
                opacity: _headerFade,
                child: _buildRichHeader(context, user),
              ),
            ),
          ),

          // ── SEARCH BAR ────────────────────────────────────────────────────
          SliverToBoxAdapter(
            child: SlideTransition(
              position: _heroSlide,
              child: FadeTransition(
                opacity: _heroFade,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: Column(
                    children: [
                      _buildPremiumSearchBar(context),
                      if (_searchController.text.trim().length >= 2)
                        _buildAutocompleteDropdown(context),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // ── ACTIVE TRIP (if any) ──────────────────────────────────────────
          if (hasActiveTrip)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: _buildActiveTripBanner(currentRide),
              ),
            ),

          // ── HERO PROMO CARD ───────────────────────────────────────────────
          SliverToBoxAdapter(
            child: SlideTransition(
              position: _heroSlide,
              child: FadeTransition(
                opacity: _heroFade,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                  child: _buildPromoHeroCard(context),
                ),
              ),
            ),
          ),

          // ── SERVICE TILES ─────────────────────────────────────────────────
          SliverToBoxAdapter(
            child: SlideTransition(
              position: _servicesSlide,
              child: FadeTransition(
                opacity: _servicesFade,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                  child: _buildServiceGrid(context),
                ),
              ),
            ),
          ),

          // ── FLEET HORIZONTAL SCROLL ───────────────────────────────────────
          SliverToBoxAdapter(
            child: FadeTransition(
              opacity: _servicesFade,
              child: _buildFleetSection(context),
            ),
          ),

          // ── RECENT ACTIVITY ───────────────────────────────────────────────
          SliverToBoxAdapter(
            child: FadeTransition(
              opacity: _servicesFade,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                child: _buildRecentActivitySection(context, rideState),
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _buildBottomBar(context),
    );
  }

  // ── RICH DARK HEADER WITH GRADIENT ────────────────────────────────────────
  Widget _buildRichHeader(BuildContext context, dynamic user) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFE2E8F0), width: 1)),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top row: greeting + icons
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Greeting pill
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFFDCFCE7),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: const Color(0xFF86EFAC)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text('👋', style: TextStyle(fontSize: 12)),
                              const SizedBox(width: 5),
                              Flexible(
                                child: Text(
                                  'Namaste, ${user?.firstName ?? "Abhishek"}',
                                  style: const TextStyle(
                                    color: Color(0xFF15803D),
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.3,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 10),
                        // Brand name
                        const Text(
                          'INFURNUS',
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 2,
                            color: Color(0xFF0F172A),
                          ),
                        ),
                        const SizedBox(height: 2),
                        const Text(
                          'Move. Haul. Rise.',
                          style: TextStyle(
                            fontSize: 13,
                            color: textSilver,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    children: [
                      _buildDarkIconBtn(
                        icon: Icons.smart_toy_outlined,
                        badge: '1',
                        color: accentRide,
                        onTap: () => context.push('/ai-assistant/customer'),
                      ),
                      const SizedBox(height: 10),
                      _buildDarkIconBtn(
                        icon: Icons.notifications_outlined,
                        color: brandGreenDark,
                        onTap: () => context.push('/support'),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // ── QUICK STATS STRIP (horizontally scrollable without overflow) ──
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                physics: const BouncingScrollPhysics(),
                child: Row(
                  children: [
                    _buildStatChip(Icons.bolt_rounded, '4 Services', accentRide),
                    const SizedBox(width: 8),
                    _buildStatChip(Icons.local_shipping_outlined, 'Logistics', accentLogis),
                    const SizedBox(width: 8),
                    _buildStatChip(Icons.shield_outlined, 'Emergency', accentEmerg),
                    const SizedBox(width: 8),
                    _buildStatChip(Icons.stars_outlined, 'Rentals', accentRent),
                    const SizedBox(width: 8),
                    _buildStatChip(Icons.circle, 'Live', brandGreenDark, dot: true),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDarkIconBtn({
    required IconData icon,
    required VoidCallback onTap,
    required Color color,
    String? badge,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: borderDim),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 10,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Icon(icon, size: 20, color: color),
          ),
          if (badge != null)
            Positioned(
              right: -2,
              top: -2,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: const BoxDecoration(
                  color: Color(0xFFEF4444),
                  shape: BoxShape.circle,
                ),
                constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                child: Center(
                  child: Text(
                    badge,
                    style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildStatChip(IconData icon, String label, Color color, {bool dot = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot)
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            )
          else
            Icon(icon, size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  // ── PREMIUM SEARCH BAR ────────────────────────────────────────────────────
  Widget _buildPremiumSearchBar(BuildContext context) {
    return GestureDetector(
      onTap: () => _showSearchModal(context),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: bgCard,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: borderDim),
          boxShadow: [
            BoxShadow(
              color: brandGreen.withValues(alpha: 0.08),
              blurRadius: 20,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: const BoxDecoration(
                color: brandGreenGlow,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.search_rounded, color: brandGreen, size: 17),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Where to? Search a destination...',
                style: TextStyle(color: textMuted, fontSize: 14, fontWeight: FontWeight.w500),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [brandGreenDark, brandGreen],
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'Go →',
                style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── PROMO HERO CARD ───────────────────────────────────────────────────────
  Widget _buildPromoHeroCard(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/passenger-rides'),
      child: Container(
        constraints: const BoxConstraints(minHeight: 140),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: const LinearGradient(
            colors: [Color(0xFF032213), Color(0xFF064228), Color(0xFF0E6B3A)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: [
            BoxShadow(
              color: brandGreen.withValues(alpha: 0.25),
              blurRadius: 24,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Stack(
          children: [
            // Abstract circles decoration
            Positioned(
              right: -30,
              top: -30,
              child: Container(
                width: 150,
                height: 150,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: brandGreen.withValues(alpha: 0.08),
                ),
              ),
            ),
            Positioned(
              right: 20,
              bottom: -40,
              child: Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: brandGreen.withValues(alpha: 0.05),
                ),
              ),
            ),
            // Content
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text(
                            'ONE APP • EVERY WHEEL',
                            style: TextStyle(
                              fontSize: 8.5,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1.2,
                              color: Color(0xFF6EE7B7),
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'From auto to\nhelicopter',
                          style: TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            height: 1.15,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                          decoration: BoxDecoration(
                            color: brandGreen,
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: brandGreen.withValues(alpha: 0.4),
                                blurRadius: 10,
                                offset: const Offset(0, 3),
                              ),
                            ],
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Explore Fleet',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 11,
                                ),
                              ),
                              SizedBox(width: 4),
                              Icon(Icons.arrow_forward_rounded, size: 13, color: Colors.white),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  // INFURNUS logo
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Image.asset(
                      'assets/images/infurnus_hero_logo.png',
                      width: 95,
                      height: 95,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => Container(
                        width: 95,
                        height: 95,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.07),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(Icons.directions_car_rounded, size: 48, color: Colors.white30),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── SERVICE GRID ──────────────────────────────────────────────────────────
  Widget _buildServiceGrid(BuildContext context) {
    final services = [
      _ServiceTile(
        title: 'Rides',
        subtitle: 'Bike, Auto, Cab',
        icon: Icons.directions_car_filled_rounded,
        assetImagePath: 'assets/images/passenger_car_visual.jpg',
        color: accentRide,
        category: VehicleCategoryType.rides,
        action: () => context.push('/passenger-rides'),
      ),
      _ServiceTile(
        title: 'Logistics',
        subtitle: 'Parcels & Trucks',
        icon: Icons.local_shipping_rounded,
        assetImagePath: 'assets/images/logistics_visual.jpg',
        color: accentLogis,
        category: VehicleCategoryType.logistics,
        action: () => context.push('/logistics'),
      ),
      _ServiceTile(
        title: 'Emergency',
        subtitle: 'Ambulance & Tow',
        icon: Icons.emergency_rounded,
        assetImagePath: 'assets/images/ambulance_van.png',
        color: accentEmerg,
        category: VehicleCategoryType.emergency,
        action: () => context.push('/emergency'),
      ),
      _ServiceTile(
        title: 'Rentals',
        subtitle: 'Luxury & Chauffeur',
        icon: Icons.stars_rounded,
        assetImagePath: 'assets/images/rental_visual.jpg',
        color: accentRent,
        category: VehicleCategoryType.rental,
        action: () => context.push('/rentals'),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Services',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: textWhite, letterSpacing: 0.3),
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final bool canFitRow = constraints.maxWidth >= 320;
            if (canFitRow) {
              return Row(
                children: services.map((s) {
                  return Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(right: s == services.last ? 0 : 8),
                      child: _buildServiceTile(s),
                    ),
                  );
                }).toList(),
              );
            } else {
              return SizedBox(
                height: 120,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  itemCount: services.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    return SizedBox(
                      width: 84,
                      child: _buildServiceTile(services[index]),
                    );
                  },
                ),
              );
            }
          },
        ),
      ],
    );
  }

  Widget _buildServiceTile(_ServiceTile s) {
    return _PressableScaleCard(
      onTap: s.action,
      child: Container(
        height: 120,
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        decoration: BoxDecoration(
          color: bgCard,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: s.color.withValues(alpha: 0.2)),
          boxShadow: [
            BoxShadow(
              color: s.color.withValues(alpha: 0.1),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.15),
                    blurRadius: 4,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(4),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(9),
                child: s.assetImagePath != null
                    ? Image.asset(
                        s.assetImagePath!,
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) => Icon(s.icon ?? Icons.category_rounded, color: s.color, size: 22),
                      )
                    : Icon(s.icon, color: s.color, size: 22),
              ),
            ),
            const SizedBox(height: 7),
            Text(
              s.title,
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                color: textWhite,
              ),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              s.subtitle,
              style: TextStyle(
                fontSize: 8.5,
                fontWeight: FontWeight.w500,
                color: s.color.withValues(alpha: 0.85),
                height: 1.15,
              ),
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  // ── FLEET SECTION ─────────────────────────────────────────────────────────
  Widget _buildFleetSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Our Fleet',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: textWhite),
              ),
              GestureDetector(
                onTap: () => context.push('/passenger-rides'),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: brandGreenGlow,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: brandGreen.withValues(alpha: 0.3)),
                  ),
                  child: const Text(
                    'See all',
                    style: TextStyle(color: brandGreen, fontSize: 11, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 154,
          child: ListView(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: _allFleetItems().map((item) {
              return Padding(
                padding: const EdgeInsets.only(right: 12),
                child: _buildPremiumVehicleCard(
                  item: item,
                  onTap: () {
                    final sector = item.category == VehicleCategoryType.logistics
                        ? 'logistics'
                        : (item.category == VehicleCategoryType.emergency
                            ? 'service'
                            : (item.category == VehicleCategoryType.premium ||
                                    item.category == VehicleCategoryType.rental
                                ? 'premium'
                                : 'passenger'));
                    ref.read(rideProvider.notifier).selectSector(sector);
                    ref.read(rideProvider.notifier).selectTier(item.title.toLowerCase());
                    context.push('/ride-booking');
                  },
                ),
              );
            }).toList(),
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _buildPremiumVehicleCard({
    required _VehicleCategoryItem item,
    required VoidCallback onTap,
  }) {
    // Pick accent colour by category
    final Color accent = item.category == VehicleCategoryType.logistics
        ? accentLogis
        : item.category == VehicleCategoryType.emergency
            ? accentEmerg
            : item.category == VehicleCategoryType.premium ||
                    item.category == VehicleCategoryType.rental
                ? accentRent
                : accentRide;

    final bool isPng = item.assetImagePath?.endsWith('.png') ?? false;

    return _PressableScaleCard(
      onTap: onTap,
      child: Container(
        width: 124,
        decoration: BoxDecoration(
          color: bgCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: accent.withValues(alpha: 0.2)),
          boxShadow: [
            BoxShadow(
              color: accent.withValues(alpha: 0.08),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image area
            Expanded(
              child: ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                child: Container(
                  color: bgSurface,
                  width: double.infinity,
                  child: item.assetImagePath != null
                      ? Padding(
                          padding: isPng ? const EdgeInsets.all(6) : EdgeInsets.zero,
                          child: Image.asset(
                            item.assetImagePath!,
                            width: double.infinity,
                            fit: isPng ? BoxFit.contain : BoxFit.cover,
                            errorBuilder: (_, __, ___) => Center(
                              child: Icon(item.icon, color: accent, size: 36),
                            ),
                          ),
                        )
                      : Center(child: Icon(item.icon, color: accent, size: 36)),
                ),
              ),
            ),
            // Info
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 11.5,
                      color: textWhite,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.capacity,
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w500,
                      color: accent,
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
  }

  List<_VehicleCategoryItem> _allFleetItems() {
    return const [
      _VehicleCategoryItem(title: 'Bike', capacity: '1 rider', rate: 'Route', eta: 'Instant', icon: Icons.two_wheeler_rounded, category: VehicleCategoryType.bike, assetImagePath: 'assets/images/bike_motorcycle.png'),
      _VehicleCategoryItem(title: 'Auto', capacity: '3 seater', rate: 'Route', eta: 'Instant', icon: Icons.electric_rickshaw_rounded, category: VehicleCategoryType.auto, assetImagePath: 'assets/images/auto_rickshaw.png'),
      _VehicleCategoryItem(title: 'Hatchback', capacity: '4 seater', rate: 'Route', eta: 'Instant', icon: Icons.directions_car_rounded, category: VehicleCategoryType.rides, assetImagePath: 'assets/images/hatchback.jpg'),
      _VehicleCategoryItem(title: 'Sedan', capacity: '4 seater', rate: 'Route', eta: 'Instant', icon: Icons.directions_car_rounded, category: VehicleCategoryType.rides, assetImagePath: 'assets/images/sedan.jpg'),
      _VehicleCategoryItem(title: 'Innova Crysta', capacity: '6-7 seater', rate: 'Route', eta: 'Instant', icon: Icons.directions_car_filled_rounded, category: VehicleCategoryType.premium, assetImagePath: 'assets/images/innova_crysta.jpg'),
      _VehicleCategoryItem(title: 'Piaggio Ape', capacity: 'Up to 700 kg', rate: 'Server', eta: 'On-demand', icon: Icons.electric_rickshaw_rounded, category: VehicleCategoryType.logistics, assetImagePath: 'assets/images/piaggio_ape_yellow.png'),
      _VehicleCategoryItem(title: 'Tata Magic', capacity: 'Up to 1700 kg', rate: 'Server', eta: 'On-demand', icon: Icons.local_shipping_rounded, category: VehicleCategoryType.logistics, assetImagePath: 'assets/images/tata_magic_cream.png'),
      _VehicleCategoryItem(title: 'Ambulance', capacity: 'Medical Triage', rate: 'Trip', eta: 'Priority', icon: Icons.medical_services_rounded, category: VehicleCategoryType.emergency, assetImagePath: 'assets/images/ambulance_van.png'),
      _VehicleCategoryItem(title: 'Towing Van', capacity: 'Breakdown Assist', rate: 'Trip', eta: 'Priority', icon: Icons.car_repair_rounded, category: VehicleCategoryType.emergency, assetImagePath: 'assets/images/towing_van.jpg'),
      _VehicleCategoryItem(title: 'Fortuner', capacity: 'Executive SUV', rate: 'Chauffeur', eta: 'Scheduled', icon: Icons.stars_rounded, category: VehicleCategoryType.premium, assetImagePath: 'assets/images/fortuner_visual.jpg'),
      _VehicleCategoryItem(title: 'Scorpio N', capacity: 'Rugged SUV', rate: 'Chauffeur', eta: 'Scheduled', icon: Icons.stars_rounded, category: VehicleCategoryType.premium, assetImagePath: 'assets/images/scorpio_n_white.png'),
    ];
  }

  // ── RECENT ACTIVITY ───────────────────────────────────────────────────────
  Widget _buildRecentActivitySection(BuildContext context, dynamic rideState) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Recent Activity',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: textWhite),
            ),
            if (rideState.history.isNotEmpty)
              GestureDetector(
                onTap: () => context.push('/booking-history'),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: bgCard,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: borderDim),
                  ),
                  child: const Text(
                    'View All',
                    style: TextStyle(color: textSilver, fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (_isLoadingHistory && rideState.history.isEmpty)
          const InfurnusSkeletonCard()
        else if (rideState.history.isNotEmpty)
          _buildActivityCard(rideState.history.first)
        else
          _buildNoTripsCard(context),
      ],
    );
  }

  Widget _buildNoTripsCard(BuildContext context) {
    return GestureDetector(
      onTap: () {
        ref.read(rideProvider.notifier).selectSector('passenger');
        context.push('/ride-booking');
      },
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: bgCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: borderDim),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: accentRide.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Icon(Icons.route_rounded, color: accentRide, size: 22),
            ),
            const SizedBox(width: 14),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'No trips yet',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: textWhite),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Book your first ride now →',
                    style: TextStyle(fontSize: 12, color: textSilver),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: brandGreenGlow,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.arrow_forward_rounded, color: brandGreen, size: 16),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActivityCard(model.RideModel ride) {
    final formattedDate = DateFormat('MMM d, h:mm a').format(ride.createdAt);
    final isCancelled   = ride.status == model.RideStatus.cancelled;
    final isCompleted   = ride.status == model.RideStatus.completed;
    final statusColor   = isCancelled ? accentEmerg : isCompleted ? brandGreen : accentRide;

    return Container(
      decoration: BoxDecoration(
        color: bgCard,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: statusColor.withValues(alpha: 0.2)),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
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
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    ride.sector == 'logistics'
                        ? Icons.local_shipping_rounded
                        : ride.sector == 'service'
                            ? Icons.emergency_rounded
                            : ride.sector == 'premium'
                                ? Icons.stars_rounded
                                : Icons.directions_car_rounded,
                    color: statusColor,
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
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                          color: textWhite,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(5),
                            ),
                            child: Text(
                              _formatStatus(ride.status).toUpperCase(),
                              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: statusColor),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(formattedDate, style: const TextStyle(color: textMuted, fontSize: 11)),
                        ],
                      ),
                    ],
                  ),
                ),
                if (!isCancelled && ride.displayFare > 0) ...[
                  const SizedBox(width: 8),
                  Text(
                    '₹${ride.displayFare.toStringAsFixed(0)}',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: textWhite),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── ACTIVE TRIP BANNER ────────────────────────────────────────────────────
  Widget _buildActiveTripBanner(model.RideModel currentRide) {
    return GestureDetector(
      onTap: () => context.push('/ride-booking'),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [brandGreenDark, brandGreen.withValues(alpha: 0.8)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(color: brandGreen.withValues(alpha: 0.3), blurRadius: 16, offset: const Offset(0, 4)),
          ],
        ),
        child: Row(
          children: [
            const Icon(Icons.navigation_rounded, color: Colors.white, size: 26),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('ACTIVE TRIP', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.w900, letterSpacing: 1)),
                  const SizedBox(height: 2),
                  Text(
                    currentRide.destinationAddress ?? 'Heading to Destination',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white, size: 16),
          ],
        ),
      ),
    );
  }

  // ── BOTTOM NAVIGATION BAR ─────────────────────────────────────────────────
  Widget _buildBottomBar(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: borderDim, width: 1)),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 16, offset: const Offset(0, -3)),
        ],
      ),
      child: SafeArea(
        top: false,
        child: BottomNavigationBar(
          selectedItemColor: brandGreenDark,
          unselectedItemColor: const Color(0xFF64748B),
          currentIndex: 0,
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.transparent,
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
              icon: Icon(Icons.receipt_long_outlined),
              activeIcon: Icon(Icons.receipt_long_rounded),
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
      ),
    );
  }

  // ── SEARCH MODAL ──────────────────────────────────────────────────────────
  final List<Map<String, dynamic>> _quickDestinations = [
    {'label': 'Airport T1',       'icon': Icons.flight_rounded,        'address': 'Airport Terminal 1, International Hub', 'coords': const LatLng(25.5913, 85.0880)},
    {'label': 'Railway Station',  'icon': Icons.train_rounded,         'address': 'Patna Junction Railway Station',        'coords': const LatLng(25.6022, 85.1376)},
    {'label': 'Gandhi Maidan',    'icon': Icons.location_city_rounded, 'address': 'Gandhi Maidan, Patna',                 'coords': const LatLng(25.6154, 85.1437)},
    {'label': 'Boring Road',      'icon': Icons.business_rounded,      'address': 'Boring Road Chauraha, Patna',          'coords': const LatLng(25.6127, 85.1189)},
  ];

  void _showSearchModal(BuildContext context) {
    List<PlaceSuggestion> modalSuggestions = [];
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: bgCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (context) {
        return StatefulBuilder(builder: (context, setModalState) {
          return Padding(
            padding: EdgeInsets.only(
              left: 20, right: 20, top: 20,
              bottom: MediaQuery.of(context).viewInsets.bottom + 24,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Where to?', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: textWhite)),
                      IconButton(
                        icon: const Icon(Icons.close_rounded, color: textSilver),
                        onPressed: () => Navigator.pop(context),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: bgSurface,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: borderDim),
                    ),
                    child: Column(children: [
                      const Row(children: [
                        Icon(Icons.my_location_rounded, color: brandGreen, size: 18),
                        SizedBox(width: 12),
                        Text('Current Location (GPS Active)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: textWhite)),
                      ]),
                      const Padding(
                        padding: EdgeInsets.only(left: 8, top: 4, bottom: 4),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: SizedBox(height: 16, child: VerticalDivider(color: textMuted, thickness: 2)),
                        ),
                      ),
                      Row(children: [
                        const Icon(Icons.location_on_rounded, color: accentEmerg, size: 18),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            autofocus: true,
                            style: const TextStyle(color: textWhite, fontWeight: FontWeight.w600),
                            cursorColor: brandGreen,
                            decoration: const InputDecoration(
                              hintText: 'Search destination...',
                              hintStyle: TextStyle(color: textMuted),
                              border: InputBorder.none,
                              isDense: true,
                              contentPadding: EdgeInsets.zero,
                            ),
                            onChanged: (val) async {
                              if (val.trim().isNotEmpty) {
                                final service = ref.read(placesAutocompleteServiceProvider);
                                final results = await service.getSuggestions(val);
                                setModalState(() => modalSuggestions = results);
                              } else {
                                setModalState(() => modalSuggestions = []);
                              }
                            },
                            onSubmitted: (val) {
                              if (val.trim().isNotEmpty) {
                                Navigator.pop(context);
                                ref.read(rideProvider.notifier).setRoute('Current Location', val.trim());
                                context.push('/ride-booking');
                              }
                            },
                          ),
                        ),
                      ]),
                    ]),
                  ),
                  const SizedBox(height: 16),
                  const Text('Quick Destinations', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: textSilver)),
                  const SizedBox(height: 10),
                  SizedBox(
                    height: 36,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: _quickDestinations.map((dest) {
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ActionChip(
                            avatar: Icon(dest['icon'] as IconData, size: 14, color: brandGreen),
                            label: Text(dest['label'] as String, style: const TextStyle(fontSize: 11, color: textWhite)),
                            backgroundColor: bgSurface,
                            shape: const RoundedRectangleBorder(
                              borderRadius: BorderRadius.all(Radius.circular(18)),
                              side: BorderSide(color: borderDim),
                            ),
                            onPressed: () {
                              Navigator.pop(context);
                              ref.read(rideProvider.notifier).setRoute('Current Location', dest['address'] as String);
                              if (dest['coords'] != null) {
                                ref.read(rideProvider.notifier).setDestinationCoords(dest['coords'] as LatLng, address: dest['address'] as String);
                              }
                              context.push('/ride-booking');
                            },
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  if (modalSuggestions.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    const Text('Suggestions', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: textSilver)),
                    const SizedBox(height: 8),
                    ...modalSuggestions.map((s) {
                      return InkWell(
                        onTap: () { Navigator.pop(context); _selectSuggestion(s); },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          child: Row(
                            children: [
                              const Icon(Icons.location_on_outlined, size: 18, color: textSilver),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(s.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: textWhite), maxLines: 1, overflow: TextOverflow.ellipsis),
                                    Text(s.subtitle, style: const TextStyle(fontSize: 12, color: textSilver), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                  ],
                ],
              ),
            ),
          );
        });
      },
    );
  }

  Widget _buildAutocompleteDropdown(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: bgCard,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderDim),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 16, offset: const Offset(0, 4))],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: _suggestions.isEmpty
            ? [const Padding(padding: EdgeInsets.all(12), child: Text('No locations found.', style: TextStyle(color: textMuted)))]
            : _suggestions.map((s) => InkWell(
                onTap: () => _selectSuggestion(s),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  child: Row(
                    children: [
                      const Icon(Icons.location_on_outlined, size: 16, color: textSilver),
                      const SizedBox(width: 12),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(s.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: textWhite), maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text(s.subtitle, style: const TextStyle(fontSize: 11, color: textSilver), maxLines: 1, overflow: TextOverflow.ellipsis),
                      ])),
                      const Icon(Icons.north_west_rounded, size: 13, color: textMuted),
                    ],
                  ),
                ),
              )).toList(),
      ),
    );
  }

  String _formatStatus(model.RideStatus status) {
    switch (status) {
      case model.RideStatus.requested:      return 'Requested';
      case model.RideStatus.searching:      return 'Searching';
      case model.RideStatus.driverAssigned: return 'Driver Assigned';
      case model.RideStatus.driverArriving: return 'Driver Arriving';
      case model.RideStatus.driverArrived:  return 'Driver Arrived';
      case model.RideStatus.inProgress:     return 'In Progress';
      case model.RideStatus.completed:      return 'Completed';
      case model.RideStatus.cancelled:      return 'Cancelled';
    }
  }
}

// ── DATA MODELS ───────────────────────────────────────────────────────────────
class _VehicleCategoryItem {
  final String title;
  final String capacity;
  final String rate;
  final String eta;
  final IconData icon;
  final VehicleCategoryType category;
  final String? assetImagePath;

  const _VehicleCategoryItem({
    required this.title,
    required this.capacity,
    required this.rate,
    required this.eta,
    required this.icon,
    required this.category,
    this.assetImagePath,
  });
}

class _ServiceTile {
  final String title;
  final String subtitle;
  final IconData? icon;
  final String? assetImagePath;
  final Color color;
  final VehicleCategoryType category;
  final VoidCallback action;
  const _ServiceTile({
    required this.title,
    required this.subtitle,
    this.icon,
    this.assetImagePath,
    required this.color,
    required this.category,
    required this.action,
  });
}

// ── PRESSABLE SCALE CARD ──────────────────────────────────────────────────────
class _PressableScaleCard extends StatefulWidget {
  final Widget child;
  final VoidCallback onTap;

  const _PressableScaleCard({required this.child, required this.onTap});

  @override
  State<_PressableScaleCard> createState() => _PressableScaleCardState();
}

class _PressableScaleCardState extends State<_PressableScaleCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 100), lowerBound: 0.0, upperBound: 1.0);
    _scale = Tween<double>(begin: 1.0, end: 0.95).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut));
  }

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => _ctrl.forward(),
      onTapUp: (_) { _ctrl.reverse(); widget.onTap(); },
      onTapCancel: () => _ctrl.reverse(),
      child: ScaleTransition(scale: _scale, child: widget.child),
    );
  }
}
