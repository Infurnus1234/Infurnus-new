import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../shared/widgets/infurnus_empty_state.dart';
import '../../../../shared/widgets/infurnus_skeleton.dart';
import '../../data/models/ride_model.dart' as model;
import '../providers/ride_provider.dart';
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

  // Premium Dark Theme Palette
  static const Color mainBg = Color(0xFF000000);
  static const Color cardBg = Color(0xFF111111);
  static const Color cardElevated = Color(0xFF151515);
  static const Color borderCard = Color(0xFF262626);
  static const Color borderSearch = Color(0xFF292929);
  static const Color textWhite = Color(0xFFFFFFFF);
  static const Color textGray = Color(0xFFA1A1AA);
  static const Color textMuted = Color(0xFF737373);

  // Accent Colors
  static const Color brandGreen = Color(0xFF22C55E);
  static const Color logisticsOrange = Color(0xFFF59E0B);
  static const Color serviceRed = Color(0xFFEF4444);
  static const Color premiumBlue = Color(0xFF3B82F6);
  static const Color goldAccent = Color(0xFFFACC15);

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _headerFade = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.0, 0.4, curve: Curves.easeOut),
    );
    _headerSlide = Tween<Offset>(
      begin: const Offset(0, -0.1),
      end: Offset.zero,
    ).animate(_headerFade);

    _heroFade = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.2, 0.6, curve: Curves.easeOut),
    );
    _heroSlide = Tween<Offset>(
      begin: const Offset(0, 0.1),
      end: Offset.zero,
    ).animate(_heroFade);

    _servicesFade = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.4, 0.8, curve: Curves.easeOut),
    );
    _servicesSlide = Tween<Offset>(
      begin: const Offset(0, 0.1),
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
    _animController.dispose();
    super.dispose();
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
      body: Stack(
        children: [
          // Background ambient green glow top accent
          Positioned(
            top: -60,
            right: -60,
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: brandGreen.withValues(alpha: 0.12),
                boxShadow: [
                  BoxShadow(
                    color: brandGreen.withValues(alpha: 0.12),
                    blurRadius: 100,
                    spreadRadius: 20,
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            bottom: 120,
            left: -80,
            child: Container(
              width: 220,
              height: 240,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: premiumBlue.withValues(alpha: 0.08),
                boxShadow: [
                  BoxShadow(
                    color: premiumBlue.withValues(alpha: 0.08),
                    blurRadius: 100,
                    spreadRadius: 20,
                  ),
                ],
              ),
            ),
          ),

          SafeArea(
            child: RefreshIndicator(
              color: brandGreen,
              backgroundColor: cardBg,
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
                    // Stagger 1: Header
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
                            const SizedBox(height: 20),
                            _buildHeroFeatureCard(context),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),

                    // Active Trip Banner (if any)
                    if (hasActiveTrip) ...[
                      _buildActiveTripBanner(currentRide),
                      const SizedBox(height: 28),
                    ],

                    // Stagger 3: Services Sections
                    SlideTransition(
                      position: _servicesSlide,
                      child: FadeTransition(
                        opacity: _servicesFade,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // 1. Passenger Section
                            _buildPassengerSection(context),
                            const SizedBox(height: 28),

                            // 2. Logistics Section
                            _buildLogisticsSection(context),
                            const SizedBox(height: 28),

                            // 3. Service Fleet Section
                            _buildServiceFleetSection(context),
                            const SizedBox(height: 28),

                            // 4. Premium Concierge Fleet Section
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
        ],
      ),
      bottomNavigationBar: _buildBottomNavigationBar(context),
    );
  }

  Widget _buildHeader(BuildContext context, dynamic user) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
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
                    color: brandGreen,
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
                        color: textWhite,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '👋 ${user?.firstName ?? "User"}',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: textGray,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                const Text(
                  'Move. Haul. Rise.',
                  style: TextStyle(
                    fontSize: 12,
                    color: textGray,
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
                const SizedBox(width: 8),
                _buildHeaderIcon(
                  icon: Icons.person_outline_rounded,
                  tooltip: 'Profile',
                  onTap: () => context.push('/profile'),
                ),
              ],
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
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A1A),
              shape: BoxShape.circle,
              border: Border.all(color: borderCard),
            ),
            child: Icon(icon, size: 20, color: textWhite),
          ),
          if (showBadge)
            Positioned(
              right: 2,
              top: 2,
              child: Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: brandGreen,
                  shape: BoxShape.circle,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDestinationSearchBar(BuildContext context) {
    return _PressableScaleCard(
      onTap: () {
        ref
            .read(rideProvider.notifier)
            .setRoute('Current Location', 'Airport Terminal 1');
        context.push('/ride-booking');
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        decoration: BoxDecoration(
          color: cardBg,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: borderSearch),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.6),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            const Icon(
              Icons.search_rounded,
              color: Color(0xFFD4D4D4),
              size: 20,
            ),
            const SizedBox(width: 12),
            const Text(
              'Where to today?',
              style: TextStyle(
                color: textMuted,
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
            const Spacer(),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: premiumBlue,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.mic_rounded,
                color: Colors.white,
                size: 16,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeroFeatureCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1E3A8A), Color(0xFF2563EB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: premiumBlue.withValues(alpha: 0.3),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'ONE APP • EVERY WHEEL',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.5,
                    color: Color(0xFF93C5FD),
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'From auto to\nhelicopter',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    color: textWhite,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () {
                    ref.read(rideProvider.notifier).selectSector('passenger');
                    context.push('/ride-booking');
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                    ),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 10,
                    ),
                    elevation: 0,
                  ),
                  child: const Text(
                    'Explore fleet →',
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.stars_rounded,
              size: 48,
              color: Color(0xFFFDE047),
            ),
          ),
        ],
      ),
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
      ),
      _VehicleCategoryItem(
        title: 'Auto',
        capacity: '3 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.electric_rickshaw_rounded,
      ),
      _VehicleCategoryItem(
        title: 'Mini / Compact',
        capacity: '4 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.directions_car_rounded,
      ),
      _VehicleCategoryItem(
        title: 'Sedan',
        capacity: '4 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.airport_shuttle_rounded,
      ),
      _VehicleCategoryItem(
        title: 'SUV',
        capacity: '6 seater',
        rate: 'Route Estimate',
        eta: 'Instant',
        icon: Icons.directions_car_filled_rounded,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader(
          title: 'Passenger',
          subtitle: 'Everyday rides across the city',
          onSeeAll: () {
            ref.read(rideProvider.notifier).selectSector('passenger');
            context.push('/ride-booking');
          },
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 150,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return _buildHorizontalVehicleCard(
                item: item,
                accentColor: brandGreen,
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
      ),
      _VehicleCategoryItem(
        title: '3-Wheeler',
        capacity: 'Up to 300 kg',
        rate: 'Server Rate',
        eta: 'On-demand',
        icon: Icons.electric_rickshaw_rounded,
      ),
      _VehicleCategoryItem(
        title: 'Mini Truck 1T',
        capacity: 'Up to 1000 kg',
        rate: 'Server Rate',
        eta: 'On-demand',
        icon: Icons.local_shipping_rounded,
      ),
      _VehicleCategoryItem(
        title: 'Tata 407',
        capacity: 'Up to 2500 kg',
        rate: 'Server Rate',
        eta: 'On-demand',
        icon: Icons.directions_bus_outlined,
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
          height: 150,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return _buildHorizontalVehicleCard(
                item: item,
                accentColor: logisticsOrange,
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
      ),
      _VehicleCategoryItem(
        title: 'Towing Van',
        capacity: 'Vehicle Breakdown Assist',
        rate: 'Trip-Based',
        eta: 'Priority',
        icon: Icons.car_repair_rounded,
      ),
      _VehicleCategoryItem(
        title: 'JCB / Excavator',
        capacity: 'Specialty Excavation',
        rate: 'Trip-Based',
        eta: 'Scheduled',
        icon: Icons.agriculture_rounded,
      ),
      _VehicleCategoryItem(
        title: 'Recovery Vehicle',
        capacity: 'Heavy Winch Assist',
        rate: 'Trip-Based',
        eta: 'Priority',
        icon: Icons.rv_hookup_rounded,
      ),
      _VehicleCategoryItem(
        title: 'Roadside Service',
        capacity: 'Mechanic / Tire Repair',
        rate: 'Trip-Based',
        eta: 'Priority',
        icon: Icons.build_rounded,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader(
          title: 'Service Fleet',
          subtitle: 'Emergency & specialty support',
          onSeeAll: () {
            ref.read(rideProvider.notifier).selectSector('service');
            context.push('/ride-booking');
          },
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 150,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return _buildHorizontalVehicleCard(
                item: item,
                accentColor: serviceRed,
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
      ),
      _LuxuryVehicleItem(
        title: 'Toyota Fortuner',
        badge: 'Executive',
        subtitle: 'Commanding presence',
        price: 'Chauffeur + Fuel',
      ),
      _LuxuryVehicleItem(
        title: 'BMW / Mercedes SUV',
        badge: 'VIP Luxury',
        subtitle: 'Flagship luxury suite',
        price: 'Chauffeur + Fuel',
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
                    color: const Color(0xFF1E1B00),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: goldAccent.withValues(alpha: 0.5),
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
                    color: textWhite,
                  ),
                ),
                const Text(
                  'Luxury on-demand • Sky, road, off-road',
                  style: TextStyle(fontSize: 12, color: textGray),
                ),
              ],
            ),
            GestureDetector(
              onTap: () => context.push('/rentals'),
              child: const Text(
                'See all →',
                style: TextStyle(
                  color: goldAccent,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),

        // Full-Width Luxury Cards
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
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: cardBg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: borderCard),
        ),
        child: Row(
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
                      color: const Color(0xFF1F1A00),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: goldAccent.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Text(
                      item.badge,
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: goldAccent,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    item.title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      color: textWhite,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.subtitle,
                    style: const TextStyle(fontSize: 12, color: textGray),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    item.price,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      color: goldAccent,
                    ),
                  ),
                ],
              ),
            ),
            ElevatedButton(
              onPressed: () => context.push('/rentals'),
              style: ElevatedButton.styleFrom(
                backgroundColor: goldAccent,
                foregroundColor: Colors.black,
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
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
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
                color: textWhite,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(fontSize: 12, color: textGray),
            ),
          ],
        ),
        GestureDetector(
          onTap: onSeeAll,
          child: const Text(
            'See all ↗',
            style: TextStyle(
              color: textGray,
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
    required Color accentColor,
    required VoidCallback onTap,
  }) {
    return _PressableScaleCard(
      onTap: onTap,
      child: Container(
        width: 140,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: cardBg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: borderCard),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(item.icon, color: accentColor, size: 20),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: textWhite,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  item.capacity,
                  style: const TextStyle(fontSize: 11, color: textGray),
                ),
                const SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      item.rate,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 10,
                        color: accentColor,
                      ),
                    ),
                    Text(
                      item.eta,
                      style: const TextStyle(fontSize: 10, color: textGray),
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
          color: cardElevated,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: brandGreen.withValues(alpha: 0.5)),
          boxShadow: [
            BoxShadow(
              color: brandGreen.withValues(alpha: 0.2),
              blurRadius: 16,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: brandGreen.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.navigation_rounded,
                color: brandGreen,
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
                          color: brandGreen,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          'ACTIVE TRIP',
                          style: TextStyle(
                            color: Colors.black,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _formatStatus(currentRide.status),
                        style: const TextStyle(color: textGray, fontSize: 12),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    currentRide.destinationAddress ?? 'Heading to Destination',
                    style: const TextStyle(
                      color: textWhite,
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
              color: brandGreen,
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
                color: textWhite,
              ),
            ),
            if (rideState.history.isNotEmpty)
              GestureDetector(
                onTap: () => context.push('/booking-history'),
                child: const Text(
                  'View All →',
                  style: TextStyle(
                    color: brandGreen,
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
        color: cardBg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderCard),
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
                        ? serviceRed.withValues(alpha: 0.15)
                        : brandGreen.withValues(alpha: 0.15),
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
                    color: isCancelled ? serviceRed : brandGreen,
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
                          color: textWhite,
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
                                  ? serviceRed.withValues(alpha: 0.2)
                                  : brandGreen.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              _formatStatus(ride.status).toUpperCase(),
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                                color: isCancelled ? serviceRed : brandGreen,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            formattedDate,
                            style: const TextStyle(
                              color: textGray,
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
                      color: textWhite,
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
        color: Color(0xFF050505),
        border: Border(top: BorderSide(color: borderCard, width: 1.0)),
      ),
      child: BottomNavigationBar(
        selectedItemColor: brandGreen,
        unselectedItemColor: textMuted,
        currentIndex: 0,
        type: BottomNavigationBarType.fixed,
        backgroundColor: const Color(0xFF050505),
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
          BottomNavigationBarItem(icon: Icon(Icons.home_filled), label: 'Home'),
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

  const _VehicleCategoryItem({
    required this.title,
    required this.capacity,
    required this.rate,
    required this.eta,
    required this.icon,
  });
}

class _LuxuryVehicleItem {
  final String title;
  final String badge;
  final String subtitle;
  final String price;

  const _LuxuryVehicleItem({
    required this.title,
    required this.badge,
    required this.subtitle,
    required this.price,
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
