import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/splash/presentation/screens/splash_screen.dart';
import '../../features/onboarding/presentation/screens/onboarding_screen.dart';
import '../../features/auth/presentation/screens/welcome_screen.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/signup_screen.dart';
import '../../features/auth/presentation/screens/otp_screen.dart';
import '../../features/auth/presentation/screens/location_permission_screen.dart';
import '../../features/auth/presentation/screens/notifications_permission_screen.dart';
import '../../features/auth/presentation/screens/setup_complete_screen.dart';
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
import '../../features/driver/presentation/screens/fleet_dashboard_screen.dart';
import '../../features/driver/presentation/screens/fleet_vehicles_screen.dart';
import '../../features/driver/presentation/screens/fleet_drivers_screen.dart';
import '../../features/driver/presentation/screens/provider_bank_account_screen.dart';
import '../../features/driver/presentation/screens/support_tickets_screen.dart';
import '../../features/customer/presentation/screens/rentals_screen.dart';
import '../../features/customer/presentation/screens/logistics_screen.dart';
import '../../features/ai_assistant/presentation/screens/ai_assistant_screen.dart';
import '../../features/customer/presentation/screens/legal_document_screen.dart';
import '../../features/customer/presentation/screens/delete_account_screen.dart';
import '../../features/customer/presentation/screens/booking_history_screen.dart';
import '../../features/support/presentation/screens/support_screen.dart';
import '../../features/admin/presentation/screens/fleet_analytics_dashboard_screen.dart';

class RouterNotifier extends ChangeNotifier {
  final Ref _ref;
  AuthStatus _status = AuthStatus.initial;

  RouterNotifier(this._ref) {
    _ref.listen(authProvider, (previous, next) {
      if (_status != next.status) {
        _status = next.status;
        notifyListeners();
      }
    });
  }

  AuthStatus get status => _status;
}

final routerNotifierProvider = ChangeNotifierProvider((ref) => RouterNotifier(ref));

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = ref.read(routerNotifierProvider);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: notifier,
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/welcome',
        builder: (context, state) => const WelcomeScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
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
        path: '/location-permission',
        builder: (context, state) => const LocationPermissionScreen(),
      ),
      GoRoute(
        path: '/notifications-permission',
        builder: (context, state) => const NotificationsPermissionScreen(),
      ),
      GoRoute(
        path: '/setup-complete',
        builder: (context, state) => const SetupCompleteScreen(),
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
        path: '/driver/dashboard',
        redirect: (_, __) => '/driver-dashboard',
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
        path: '/fleet-dashboard',
        builder: (context, state) => const FleetDashboardScreen(),
      ),
      GoRoute(
        path: '/fleet-vehicles',
        builder: (context, state) => const FleetVehiclesScreen(),
      ),
      GoRoute(
        path: '/fleet-drivers',
        builder: (context, state) => const FleetDriversScreen(),
      ),
      GoRoute(
        path: '/provider-bank-account',
        builder: (context, state) => const ProviderBankAccountScreen(),
      ),
      GoRoute(
        path: '/support-tickets',
        builder: (context, state) => const SupportTicketsScreen(),
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
        path: '/admin/fleet-analytics',
        builder: (context, state) => const FleetAnalyticsDashboardScreen(),
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
      final status = notifier.status;
      
      final isAuthFlow = state.matchedLocation == '/welcome' ||
                         state.matchedLocation == '/onboarding' ||
                         state.matchedLocation == '/login' || 
                         state.matchedLocation == '/otp' || 
                         state.matchedLocation == '/signup' ||
                         state.matchedLocation == '/location-permission' ||
                         state.matchedLocation == '/notifications-permission' ||
                         state.matchedLocation == '/setup-complete';
      final isSplash = state.matchedLocation == '/splash';

      if (status == AuthStatus.initial) return isSplash ? null : '/splash';
      
      if (status == AuthStatus.unauthenticated) {
        return isAuthFlow ? null : '/welcome';
      }

      if (status == AuthStatus.authenticated) {
        if (isAuthFlow || isSplash) return '/customer-home';
      }

      return null;
    },
  );
});
