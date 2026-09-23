import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../../shared/widgets/infurnus_brand_mark.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_empty_state.dart';
import '../../../../shared/widgets/infurnus_error_view.dart';
import '../../../../shared/widgets/infurnus_map.dart';
import '../../../../shared/widgets/infurnus_skeleton.dart';
import '../../data/models/fleet_analytics_model.dart';
import '../providers/admin_fleet_provider.dart';

class FleetAnalyticsDashboardScreen extends ConsumerStatefulWidget {
  const FleetAnalyticsDashboardScreen({super.key});

  @override
  ConsumerState<FleetAnalyticsDashboardScreen> createState() =>
      _FleetAnalyticsDashboardScreenState();
}

class _FleetAnalyticsDashboardScreenState
    extends ConsumerState<FleetAnalyticsDashboardScreen> {
  final TextEditingController _searchController = TextEditingController();

  static const Color primaryBlue = Color(0xFF2563EB);
  static const Color mainBg = Color(0xFFF5F7FB);
  static const Color cardBg = Colors.white;
  static const Color textPrimary = Color(0xFF111827);
  static const Color textSecondary = Color(0xFF6B7280);

  static const Color activeGreen = Color(0xFF16A34A);
  static const Color activeBg = Color(0xFFDCFCE7);
  static const Color onTripBlue = Color(0xFF2563EB);
  static const Color onTripBg = Color(0xFFDBEAFE);
  static const Color offlineRed = Color(0xFFDC2626);
  static const Color offlineBg = Color(0xFFFEE2E2);

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(adminFleetNotifierProvider);
    final notifier = ref.read(adminFleetNotifierProvider.notifier);
    final isDesktop = MediaQuery.of(context).size.width >= 900;

    return Scaffold(
      backgroundColor: mainBg,
      body: SafeArea(
        child: Row(
          children: [
            if (isDesktop) _buildSidebar(context),
            Expanded(
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.all(isDesktop ? 28.0 : 16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildHeader(context, isDesktop),
                          const SizedBox(height: 20),

                          if (state.isLoading && state.summary == null)
                            _buildOverviewSkeleton(isDesktop)
                          else if (state.errorMessage != null && state.summary == null)
                            InfurnusErrorView(
                              message: state.errorMessage!,
                              onRetry: () => notifier.loadDashboardData(),
                            )
                          else ...[
                            _buildOverviewCards(state.summary, isDesktop),
                            const SizedBox(height: 24),
                            _buildFilterBar(state, notifier, isDesktop),
                            const SizedBox(height: 24),
                            _buildStateAnalyticsSection(context, state, notifier, isDesktop),
                            const SizedBox(height: 24),
                            _buildLiveMapSection(context, state, notifier, isDesktop),
                            const SizedBox(height: 24),
                            _buildVehicleListSection(context, state, notifier, isDesktop),
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (state.selectedVehicle != null)
              _buildVehicleDetailsDrawer(context, state.selectedVehicle!, notifier, isDesktop),
          ],
        ),
      ),
    );
  }

  Widget _buildSidebar(BuildContext context) {
    return Container(
      width: 240,
      decoration: const BoxDecoration(
        color: cardBg,
        border: Border(right: BorderSide(color: Color(0xFFE5E7EB))),
      ),
      child: Column(
        children: [
          const SizedBox(height: 24),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: InfurnusBrandMark(
              iconSize: 36,
              fontSize: 18,
              showText: true,
            ),
          ),
          const SizedBox(height: 32),
          _buildNavItem(Icons.dashboard_rounded, 'Dashboard', true, () {}),
          _buildNavItem(Icons.directions_car_rounded, 'Fleet', false, () {}),
          _buildNavItem(Icons.map_rounded, 'Live Tracking', false, () {}),
          _buildNavItem(Icons.analytics_rounded, 'Analytics', false, () {}),
          _buildNavItem(Icons.receipt_long_rounded, 'Bookings', false, () {}),
          const Spacer(),
          _buildNavItem(Icons.arrow_back_rounded, 'Exit Admin', false, () {
            context.go('/customer-home');
          }),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildNavItem(IconData icon, String title, bool isSelected, VoidCallback onTap) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: isSelected ? const Color(0xFFEFF6FF) : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
      ),
      child: ListTile(
        onTap: onTap,
        dense: true,
        leading: Icon(icon, color: isSelected ? primaryBlue : textSecondary),
        title: Text(
          title,
          style: TextStyle(
            color: isSelected ? primaryBlue : textPrimary,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
            fontSize: 14,
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, bool isDesktop) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Fleet Management',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: textPrimary,
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'Monitor your vehicles, drivers and operations in real time.',
                    style: TextStyle(fontSize: 13, color: textSecondary),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.notifications_none_rounded, color: textSecondary),
                  onPressed: () {},
                ),
                const SizedBox(width: 8),
                const CircleAvatar(
                  radius: 18,
                  backgroundColor: primaryBlue,
                  child: Text('A', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildOverviewCards(FleetAnalyticsSummaryModel? summary, bool isDesktop) {
    final total = summary?.totalVehicles ?? 0;
    final active = summary?.activeVehicles ?? 0;
    final onTrip = summary?.onTripVehicles ?? 0;
    final offline = summary?.offlineVehicles ?? 0;
    final pct = summary?.activePercentage ?? 0.0;

    final cards = [
      _buildCard('Total Vehicles', '$total', 'Registered fleet', Icons.directions_car_rounded, primaryBlue, const Color(0xFFEFF6FF)),
      _buildCard('Active', '$active', '${pct.toStringAsFixed(1)}% of fleet', Icons.check_circle_rounded, activeGreen, activeBg),
      _buildCard('On Trip', '$onTrip', 'Currently operating', Icons.navigation_rounded, onTripBlue, onTripBg),
      _buildCard('Offline', '$offline', 'Needs attention', Icons.offline_bolt_rounded, offlineRed, offlineBg),
    ];

    if (isDesktop) {
      return Row(
        children: cards.map((c) => Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 6), child: c))).toList(),
      );
    }

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.5,
      children: cards,
    );
  }

  Widget _buildCard(String title, String count, String subtitle, IconData icon, Color color, Color iconBg) {
    return InfurnusCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(child: Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: textSecondary), overflow: TextOverflow.ellipsis)),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, color: color, size: 20),
              ),
            ],
          ),
          Text(count, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: textPrimary)),
          Text(subtitle, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500), overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }

  Widget _buildFilterBar(AdminFleetState state, AdminFleetNotifier notifier, bool isDesktop) {
    final states = ['All States', 'Bihar', 'Punjab', 'Uttar Pradesh', 'Delhi', 'Haryana', 'Rajasthan', 'Maharashtra'];
    final cities = ['All Cities', 'Patna', 'Gaya', 'Muzaffarpur', 'Ludhiana', 'Amritsar', 'Lucknow', 'New Delhi'];

    return InfurnusCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Wrap(
        spacing: 12,
        runSpacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          DropdownButton<String>(
            value: state.selectedState ?? 'All States',
            underline: const SizedBox(),
            icon: const Icon(Icons.arrow_drop_down_rounded, color: textSecondary),
            items: states.map((s) => DropdownMenuItem(value: s, child: Text(s, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)))).toList(),
            onChanged: (val) => notifier.setSelectedState(val),
          ),
          const SizedBox(width: 8),
          DropdownButton<String>(
            value: state.selectedCity ?? 'All Cities',
            underline: const SizedBox(),
            icon: const Icon(Icons.arrow_drop_down_rounded, color: textSecondary),
            items: cities.map((c) => DropdownMenuItem(value: c, child: Text(c, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)))).toList(),
            onChanged: (val) => notifier.setSelectedCity(val),
          ),
          const SizedBox(width: 8),
          _buildChip('All', 'all', state.selectedSector, (s) => notifier.setSelectedSector(s)),
          _buildChip('Passenger', 'passenger', state.selectedSector, (s) => notifier.setSelectedSector(s)),
          _buildChip('Logistics', 'logistics', state.selectedSector, (s) => notifier.setSelectedSector(s)),
          _buildChip('Service', 'service', state.selectedSector, (s) => notifier.setSelectedSector(s)),
          _buildChip('Premium', 'premium', state.selectedSector, (s) => notifier.setSelectedSector(s)),
        ],
      ),
    );
  }

  Widget _buildChip(String label, String value, String current, Function(String) onSelect) {
    final isSelected = value == current;
    return ChoiceChip(
      label: Text(label, style: TextStyle(fontSize: 12, color: isSelected ? Colors.white : textPrimary, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal)),
      selected: isSelected,
      selectedColor: primaryBlue,
      backgroundColor: Colors.grey[100],
      onSelected: (_) => onSelect(value),
    );
  }

  Widget _buildStateAnalyticsSection(BuildContext context, AdminFleetState state, AdminFleetNotifier notifier, bool isDesktop) {
    if (state.states.isEmpty) {
      return const InfurnusCard(
        padding: EdgeInsets.all(24),
        child: InfurnusEmptyState(
          title: 'No vehicles registered yet',
          description: 'Vehicles will appear here state-by-state once they are registered and activated.',
          icon: Icons.directions_car_outlined,
        ),
      );
    }

    return InfurnusCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Fleet by State', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary)),
                    SizedBox(height: 2),
                    Text('Monitor vehicle distribution and availability across states.', style: TextStyle(fontSize: 12, color: textSecondary), overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              TextButton(
                onPressed: () => notifier.setSelectedState('All States'),
                child: const Text('View All', style: TextStyle(color: primaryBlue, fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Column(
            children: state.states.map((st) => _buildStateRow(context, st, notifier)).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildStateRow(BuildContext context, StateFleetAnalyticsModel st, AdminFleetNotifier notifier) {
    final total = st.total == 0 ? 1 : st.total;
    final activePct = st.active / total;
    final onTripPct = st.onTrip / total;

    return InkWell(
      onTap: () {
        notifier.setSelectedState(st.state);
        _showCityBreakdownModal(context, st.state, notifier);
      },
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(st.state, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: textPrimary)),
                Text('${st.total} Vehicles', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: textSecondary)),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: SizedBox(
                height: 10,
                child: Row(
                  children: [
                    if (activePct > 0) Expanded(flex: (activePct * 100).toInt(), child: Container(color: activeGreen)),
                    if (onTripPct > 0) Expanded(flex: (onTripPct * 100).toInt(), child: Container(color: onTripBlue)),
                    Expanded(flex: ((1 - activePct - onTripPct) * 100).toInt().clamp(0, 100), child: Container(color: Colors.grey[300])),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                _buildDotLegend('Active', '${st.active}', activeGreen),
                const SizedBox(width: 16),
                _buildDotLegend('On Trip', '${st.onTrip}', onTripBlue),
                const SizedBox(width: 16),
                _buildDotLegend('Offline', '${st.offline}', offlineRed),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDotLegend(String label, String value, Color color) {
    return Row(
      children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 4),
        Text('$label $value', style: const TextStyle(fontSize: 11, color: textSecondary, fontWeight: FontWeight.w500)),
      ],
    );
  }

  void _showCityBreakdownModal(BuildContext context, String stateName, AdminFleetNotifier notifier) {
    showModalBottomSheet(
      context: context,
      backgroundColor: cardBg,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (context) {
        return Consumer(
          builder: (context, ref, _) {
            final state = ref.watch(adminFleetNotifierProvider);
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('$stateName City Breakdown', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: textPrimary)),
                      IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (state.cities.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Text('No city data available for this state.', style: TextStyle(color: textSecondary)),
                    )
                  else
                    Flexible(
                      child: ListView.builder(
                        shrinkWrap: true,
                        itemCount: state.cities.length,
                        itemBuilder: (context, index) {
                          final city = state.cities[index];
                          return ListTile(
                            title: Text(city.city, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                            subtitle: Text('Active: ${city.active} | On Trip: ${city.onTrip} | Offline: ${city.offline}', style: const TextStyle(fontSize: 12)),
                            trailing: Text('${city.total} Vehicles', style: const TextStyle(fontWeight: FontWeight.bold, color: primaryBlue)),
                            onTap: () {
                              notifier.setSelectedCity(city.city);
                              Navigator.pop(context);
                            },
                          );
                        },
                      ),
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildLiveMapSection(BuildContext context, AdminFleetState state, AdminFleetNotifier notifier, bool isDesktop) {
    final activeVehicles = state.vehicles.where((v) => v.latitude != null && v.longitude != null).toList();

    return InfurnusCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Live Fleet Map', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary)),
                    SizedBox(height: 2),
                    Text('Real-time vehicle locations and availability.', style: TextStyle(fontSize: 12, color: textSecondary), overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _buildStatusFilterChip('All', 'all', state.selectedStatus, (s) => notifier.setSelectedStatus(s)),
                    const SizedBox(width: 6),
                    _buildStatusFilterChip('Active', 'active', state.selectedStatus, (s) => notifier.setSelectedStatus(s)),
                    const SizedBox(width: 6),
                    _buildStatusFilterChip('On Trip', 'on_trip', state.selectedStatus, (s) => notifier.setSelectedStatus(s)),
                    const SizedBox(width: 6),
                    _buildStatusFilterChip('Offline', 'offline', state.selectedStatus, (s) => notifier.setSelectedStatus(s)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              height: isDesktop ? 450 : 380,
              child: activeVehicles.isEmpty
                  ? Container(
                      color: Colors.grey[100],
                      child: const Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.map_outlined, size: 48, color: textSecondary),
                            SizedBox(height: 8),
                            Text('No active vehicle GPS markers found', style: TextStyle(color: textSecondary, fontWeight: FontWeight.w500)),
                          ],
                        ),
                      ),
                    )
                  : InfurnusMap(
                      initialCameraPosition: CameraPosition(
                        target: LatLng(activeVehicles.first.latitude!, activeVehicles.first.longitude!),
                        zoom: 12,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusFilterChip(String label, String value, String current, Function(String) onSelect) {
    final isSelected = value == current;
    return InkWell(
      onTap: () => onSelect(value),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: isSelected ? primaryBlue : Colors.grey[100],
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            color: isSelected ? Colors.white : textPrimary,
          ),
        ),
      ),
    );
  }

  Widget _buildVehicleListSection(BuildContext context, AdminFleetState state, AdminFleetNotifier notifier, bool isDesktop) {
    return InfurnusCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Fleet Vehicles', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary)),
              SizedBox(
                width: 180,
                height: 36,
                child: TextField(
                  controller: _searchController,
                  onChanged: (val) => notifier.setSearchQuery(val),
                  style: const TextStyle(fontSize: 12),
                  decoration: InputDecoration(
                    hintText: 'Search plate...',
                    hintStyle: const TextStyle(fontSize: 12, color: textSecondary),
                    prefixIcon: const Icon(Icons.search, size: 16, color: textSecondary),
                    contentPadding: const EdgeInsets.symmetric(vertical: 8),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFE5E7EB))),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (state.vehicles.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: InfurnusEmptyState(
                title: 'No vehicles match query',
                description: 'Try adjusting filters or state selection.',
                icon: Icons.directions_car_outlined,
              ),
            )
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: state.vehicles.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final v = state.vehicles[index];
                return ListTile(
                  onTap: () => notifier.selectVehicle(v),
                  leading: CircleAvatar(
                    backgroundColor: _statusBg(v.status),
                    child: Icon(Icons.directions_car_rounded, color: _statusColor(v.status), size: 20),
                  ),
                  title: Row(
                    children: [
                      Text(v.plateNumber, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      const SizedBox(width: 8),
                      _buildStatusPill(v.status),
                    ],
                  ),
                  subtitle: Text('${v.make} ${v.model} • ${v.sector.toUpperCase()} • Driver: ${v.driverName ?? "Unassigned"}', style: const TextStyle(fontSize: 12, color: textSecondary)),
                  trailing: Text('${v.city}, ${v.state}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: textPrimary)),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildStatusPill(String status) {
    final color = _statusColor(status);
    final bg = _statusBg(status);
    final label = status == 'on_trip' ? 'On Trip' : (status == 'active' ? 'Active' : 'Offline');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
      child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: color)),
    );
  }

  Color _statusColor(String status) {
    if (status == 'active') return activeGreen;
    if (status == 'on_trip') return onTripBlue;
    return offlineRed;
  }

  Color _statusBg(String status) {
    if (status == 'active') return activeBg;
    if (status == 'on_trip') return onTripBg;
    return offlineBg;
  }

  Widget _buildVehicleDetailsDrawer(BuildContext context, LiveFleetVehicleModel v, AdminFleetNotifier notifier, bool isDesktop) {
    return Container(
      width: isDesktop ? 360 : MediaQuery.of(context).size.width,
      color: cardBg,
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Vehicle Details', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: textPrimary)),
              IconButton(icon: const Icon(Icons.close), onPressed: () => notifier.selectVehicle(null)),
            ],
          ),
          const SizedBox(height: 20),
          Text(v.plateNumber, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: primaryBlue)),
          const SizedBox(height: 4),
          _buildStatusPill(v.status),
          const SizedBox(height: 24),
          _buildDetailRow('Make / Model', '${v.make} ${v.model}'),
          _buildDetailRow('Sector / Category', '${v.sector.toUpperCase()} / ${v.category}'),
          _buildDetailRow('Assigned Driver', v.driverName ?? 'None'),
          _buildDetailRow('Driver Phone', v.driverPhone ?? 'N/A'),
          _buildDetailRow('Location', '${v.city}, ${v.state}'),
          _buildDetailRow('GPS Coordinates', v.latitude != null ? '${v.latitude!.toStringAsFixed(4)}, ${v.longitude!.toStringAsFixed(4)}' : 'No GPS Signal'),
          _buildDetailRow('Current Ride ID', v.currentRideId ?? 'None'),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: ElevatedButton.icon(
              onPressed: () => notifier.selectVehicle(null),
              icon: const Icon(Icons.map_rounded),
              label: const Text('Close Details'),
              style: ElevatedButton.styleFrom(backgroundColor: primaryBlue, foregroundColor: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: textSecondary)),
          Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: textPrimary)),
        ],
      ),
    );
  }

  Widget _buildOverviewSkeleton(bool isDesktop) {
    return const Column(
      children: [
        Row(
          children: [
            Expanded(child: InfurnusSkeleton(height: 100)),
            SizedBox(width: 12),
            Expanded(child: InfurnusSkeleton(height: 100)),
          ],
        ),
      ],
    );
  }
}
