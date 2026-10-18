import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'customer_home_screen.dart';
import 'ride_booking_screen.dart';
import 'passenger_rides_screen.dart';
import 'logistics_screen.dart';
import 'specialty_emergency_screen.dart';
import 'concierge_fleet_screen.dart';
import 'profile_screen.dart';
import '../../../auth/presentation/screens/login_screen.dart';

class UiKitPresentationBoardScreen extends ConsumerWidget {
  const UiKitPresentationBoardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final screens = [
      {
        'title': '1. Splash / Login',
        'route': '/login',
        'widget': const LoginScreen(),
      },
      {
        'title': '2. Home Screen',
        'route': '/customer-home',
        'widget': const CustomerHomeScreen(),
      },
      {
        'title': '3. Book a Ride',
        'route': '/ride-booking',
        'widget': const RideBookingScreen(),
      },
      {
        'title': '4. Passenger Rides',
        'route': '/passenger-rides',
        'widget': const PassengerRidesScreen(),
      },
      {
        'title': '5. Logistics',
        'route': '/logistics',
        'widget': const LogisticsScreen(),
      },
      {
        'title': '6. Specialty & Emergency',
        'route': '/specialty-emergency',
        'widget': const SpecialtyEmergencyScreen(),
      },
      {
        'title': '7. The Concierge Fleet',
        'route': '/concierge-fleet',
        'widget': const ConciergeFleetScreen(),
      },
      {
        'title': '8. Profile & Settings',
        'route': '/profile',
        'widget': const ProfileScreen(),
      },
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF0D2318), // Soft green-tinted background
      appBar: AppBar(
        backgroundColor: const Color(0xFF0A2E1A),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'INFURNUS UI KIT & DESIGN SYSTEM',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              'Move. Haul. Rise. • All 8 Production Screens (390x844 Frame)',
              style: TextStyle(color: Color(0xFF22C55E), fontSize: 12),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: ElevatedButton.icon(
              onPressed: () => context.go('/customer-home'),
              icon: const Icon(Icons.home, size: 16, color: Colors.white),
              label: const Text(
                'Open App',
                style: TextStyle(color: Colors.white),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF16A34A),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.all(24),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: screens.map((screenData) {
            final title = screenData['title'] as String;
            final route = screenData['route'] as String;
            final screenWidget = screenData['widget'] as Widget;

            return Container(
              width: 380,
              margin: const EdgeInsets.only(right: 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.open_in_new,
                          color: Color(0xFF22C55E),
                          size: 18,
                        ),
                        tooltip: 'Open Full Screen',
                        onPressed: () => context.go(route),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Container(
                    height: 800,
                    decoration: BoxDecoration(
                      color: Colors.black,
                      borderRadius: BorderRadius.circular(36),
                      border: Border.all(
                        color: const Color(0xFF16A34A),
                        width: 2.5,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.5),
                          blurRadius: 20,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(34),
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: MediaQuery(
                              data: const MediaQueryData(
                                size: Size(390, 844),
                                devicePixelRatio: 2.0,
                              ),
                              child: screenWidget,
                            ),
                          ),
                          Positioned(
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 44,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 24,
                              ),
                              alignment: Alignment.center,
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: const [
                                  Text(
                                    '9:41',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  Row(
                                    children: [
                                      Icon(
                                        Icons.signal_cellular_alt,
                                        size: 14,
                                        color: Colors.white,
                                      ),
                                      SizedBox(width: 4),
                                      Icon(
                                        Icons.wifi,
                                        size: 14,
                                        color: Colors.white,
                                      ),
                                      SizedBox(width: 4),
                                      Icon(
                                        Icons.battery_full,
                                        size: 14,
                                        color: Colors.white,
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}
