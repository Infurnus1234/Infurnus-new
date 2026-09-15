import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/signup_screen.dart';
import '../../features/auth/presentation/screens/otp_screen.dart';
import '../../features/auth/presentation/providers/auth_provider.dart';
import '../../features/customer/presentation/screens/customer_home_screen.dart';
import '../../features/customer/presentation/screens/profile_screen.dart';
import '../../features/customer/presentation/screens/ride_booking_screen.dart';
import '../../features/customer/presentation/screens/wallet_screen.dart';
import '../../features/driver/presentation/screens/driver_dashboard_screen.dart';
import '../../features/driver/presentation/screens/driver_onboarding_screen.dart';
import '../../features/driver/presentation/screens/driver_ride_request_screen.dart';
import '../../features/driver/presentation/screens/driver_financials_screen.dart';
import '../../features/driver/presentation/screens/driver_profile_screen.dart';
import '../../features/driver/presentation/screens/driver_documents_screen.dart';
import '../../features/driver/presentation/screens/driver_vehicles_screen.dart';
import '../../features/driver/presentation/screens/driver_notifications_screen.dart';
import '../../features/customer/presentation/screens/rentals_screen.dart';
import '../../features/customer/presentation/screens/logistics_screen.dart';
import '../../features/ai_assistant/presentation/screens/ai_assistant_screen.dart';
import '../../features/customer/presentation/screens/legal_document_screen.dart';
import '../../features/customer/presentation/screens/delete_account_screen.dart';
import '../../features/customer/presentation/screens/booking_history_screen.dart';
import '../../features/support/presentation/screens/support_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    initialLocation: '/splash',
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignupScreen(),
      ),
      GoRoute(
        path: '/otp',
        builder: (context, state) => const OtpScreen(),
      ),
      GoRoute(
        path: '/customer-home',
        builder: (context, state) => const CustomerHomeScreen(),
      ),
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/ride-booking',
        builder: (context, state) => const RideBookingScreen(),
      ),
      GoRoute(
        path: '/wallet',
        builder: (context, state) => const WalletScreen(),
      ),
      GoRoute(
        path: '/driver-dashboard',
        builder: (context, state) => const DriverDashboardScreen(),
      ),
      GoRoute(
        path: '/driver-onboarding',
        builder: (context, state) => const DriverOnboardingScreen(),
      ),
      GoRoute(
        path: '/driver-ride-request',
        builder: (context, state) => const DriverRideRequestScreen(),
      ),
      GoRoute(
        path: '/driver-financials',
        builder: (context, state) => const DriverFinancialsScreen(),
      ),
      GoRoute(
        path: '/driver-profile',
        builder: (context, state) => const DriverProfileScreen(),
      ),
      GoRoute(
        path: '/driver-documents',
        builder: (context, state) => const DriverDocumentsScreen(),
      ),
      GoRoute(
        path: '/driver-vehicles',
        builder: (context, state) => const DriverVehiclesScreen(),
      ),
      GoRoute(
        path: '/driver-notifications',
        builder: (context, state) => const DriverNotificationsScreen(),
      ),
      GoRoute(
        path: '/rentals',
        builder: (context, state) => const RentalsScreen(),
      ),
      GoRoute(
        path: '/logistics',
        builder: (context, state) => const LogisticsScreen(),
      ),
      GoRoute(
        path: '/ai-assistant/:role',
        builder: (context, state) => AiAssistantScreen(role: state.pathParameters['role'] ?? 'customer'),
      ),
      GoRoute(
        path: '/legal/:title',
        builder: (context, state) => LegalDocumentScreen(
          title: state.pathParameters['title'] ?? 'Legal',
          content: 'This is the canonical ${state.pathParameters['title']} for INFURNUS. Please review carefully.',
        ),
      ),
      GoRoute(
        path: '/delete-account',
        builder: (context, state) => const DeleteAccountScreen(),
      ),
      GoRoute(
        path: '/booking-history',
        builder: (context, state) => const BookingHistoryScreen(),
      ),
      GoRoute(
        path: '/support',
        builder: (context, state) => const SupportScreen(),
      ),
    ],
    redirect: (context, state) {
      final isLoggingIn = state.matchedLocation == '/login' || 
                         state.matchedLocation == '/otp' || 
                         state.matchedLocation == '/signup';
      final isSplash = state.matchedLocation == '/splash';

      if (authState.status == AuthStatus.initial) return isSplash ? null : '/splash';
      
      if (authState.status == AuthStatus.unauthenticated) {
        return isLoggingIn ? null : '/login';
      }

      if (authState.status == AuthStatus.authenticated) {
        if (isLoggingIn || isSplash) return '/customer-home';
      }

      return null;
    },
  );
});

class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Basic splash that checks auth
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              'INFURNUS',
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Color(0xFF00C853)),
            ),
            SizedBox(height: 20),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
