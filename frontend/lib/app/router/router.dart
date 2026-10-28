import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/splash/presentation/screens/splash_screen.dart';
import '../../features/onboarding/presentation/screens/onboarding_screen.dart';
import '../../features/auth/presentation/screens/welcome_screen.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/password_recovery_screen.dart';
import '../../features/auth/presentation/screens/signup_screen.dart';

import '../../features/auth/presentation/screens/otp_screen.dart';
import '../../features/auth/presentation/screens/location_permission_screen.dart';
import '../../features/auth/presentation/screens/notifications_permission_screen.dart';
import '../../features/auth/presentation/screens/setup_complete_screen.dart';
import '../../features/auth/presentation/providers/auth_provider.dart';
import '../../features/auth/presentation/providers/user_provider.dart';
import '../../features/customer/presentation/screens/passenger_rides_screen.dart';
import '../../features/customer/presentation/screens/specialty_emergency_screen.dart';
import '../../features/customer/presentation/screens/customer_home_screen.dart';
import '../../features/customer/presentation/screens/profile_screen.dart';
import '../../features/customer/presentation/screens/pickup_selection_screen.dart';
import '../../features/customer/presentation/screens/ride_booking_screen.dart';
import '../../features/customer/presentation/screens/wallet_screen.dart';
import '../../features/customer/presentation/screens/rentals_screen.dart';
import '../../features/customer/presentation/screens/logistics_screen.dart';
import '../../features/customer/presentation/screens/concierge_fleet_screen.dart';
import '../../features/ai_assistant/presentation/screens/ai_assistant_screen.dart';
import '../../core/config/legal_texts.dart';
import '../../features/customer/presentation/screens/legal_document_screen.dart';
import '../../features/customer/presentation/screens/delete_account_screen.dart';
import '../../features/customer/presentation/screens/booking_history_screen.dart';
import '../../features/support/presentation/screens/support_screen.dart';
import '../../features/driver/presentation/screens/support_tickets_screen.dart';
import '../../features/driver/presentation/screens/driver_onboarding_screen.dart';
import '../../features/customer/presentation/screens/ui_kit_presentation_board_screen.dart';

class RouterNotifier extends ChangeNotifier {
  RouterNotifier(Ref ref) {
    ref.listen(authProvider, (previous, next) => notifyListeners());
    ref.listen(userProvider, (previous, next) => notifyListeners());
  }
}

String? authRedirect(AuthState auth, String path, String? role) {
  final publicAuth = {
    '/login',
    '/signup',
    '/forgot-password',
    '/welcome',
    '/onboarding',
    '/driver-onboarding',
  };
  final publicLegal = path.startsWith('/legal/');
  switch (auth.status) {
    case AuthStatus.initial:
    case AuthStatus.restoring:
      return path == '/splash' ? null : '/splash';
    case AuthStatus.authenticated:
      if (role == null) {
        return publicAuth.contains(path) || publicLegal ? null : '/login';
      }
      if (role == 'customer') {
        return publicAuth.contains(path) || path == '/otp' || path == '/splash'
            ? '/customer-home'
            : null;
      } else {
        if (path == '/customer-home' ||
            path == '/ride-booking' ||
            path == '/passenger-rides') {
          return '/login';
        }
        if (path == '/driver-onboarding' || path.startsWith('/driver-')) {
          return null;
        }
        return publicAuth.contains(path) || path == '/otp' || path == '/splash'
            ? '/driver-onboarding'
            : null;
      }
    case AuthStatus.otpRequired:
      return path == '/otp' ? null : '/otp';
    case AuthStatus.loading:
      final verifying = auth.signupId != null || auth.loginChallengeId != null;
      if (verifying && path == '/otp') {
        return null;
      }
      return publicAuth.contains(path) || publicLegal ? null : '/login';
    case AuthStatus.unauthenticated:
      return publicAuth.contains(path) || publicLegal ? null : '/login';
  }
}

final routerNotifierProvider = ChangeNotifierProvider(
  (ref) => RouterNotifier(ref),
);

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = ref.read(routerNotifierProvider);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: notifier,
    routes: [
      GoRoute(
        path: '/ui-kit-board',
        builder: (context, state) => const UiKitPresentationBoardScreen(),
      ),
      GoRoute(
        path: '/support-tickets',
        builder: (context, state) => const SupportTicketsScreen(),
      ),
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
        path: '/driver-onboarding',
        builder: (context, state) => const DriverOnboardingScreen(),
      ),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/forgot-password',
        builder: (context, state) => PasswordRecoveryScreen(
          initialEmail: state.extra is String ? state.extra as String : '',
        ),
      ),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignupScreen(),
      ),
      GoRoute(path: '/otp', builder: (context, state) => const OtpScreen()),
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
        path: '/pickup-selection',
        builder: (context, state) {
          final sector = state.extra is String
              ? state.extra as String
              : state.uri.queryParameters['sector'];
          return PickupSelectionScreen(initialSector: sector);
        },
      ),
      GoRoute(
        path: '/passenger-rides',
        builder: (context, state) => const PassengerRidesScreen(),
      ),
      GoRoute(
        path: '/emergency',
        builder: (context, state) => const SpecialtyEmergencyScreen(),
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
        path: '/rentals',
        builder: (context, state) => const RentalsScreen(),
      ),
      GoRoute(
        path: '/logistics',
        builder: (context, state) => const LogisticsScreen(),
      ),
      GoRoute(
        path: '/specialty-emergency',
        builder: (context, state) => const SpecialtyEmergencyScreen(),
      ),
      GoRoute(
        path: '/concierge-fleet',
        builder: (context, state) => const ConciergeFleetScreen(),
      ),
      GoRoute(
        path: '/ai-assistant/:role',
        builder: (context, state) =>
            AiAssistantScreen(role: state.pathParameters['role'] ?? 'customer'),
      ),
      GoRoute(
        path: '/legal/:title',
        builder: (context, state) {
          final param = state.pathParameters['title'] ?? 'Legal Document';
          String displayTitle = 'Legal Document';
          String text = LegalTexts.privacyPolicy;
          if (param.toLowerCase().contains('term')) {
            displayTitle = 'Terms & Conditions';
            text = LegalTexts.termsOfService;
          } else if (param.toLowerCase().contains('content')) {
            displayTitle = 'Content Policy';
            text = LegalTexts.contentPolicy;
          } else if (param.toLowerCase().contains('privacy')) {
            displayTitle = 'Privacy Policy';
            text = LegalTexts.privacyPolicy;
          }
          return LegalDocumentScreen(title: displayTitle, content: text);
        },
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
      return authRedirect(
        ref.read(authProvider),
        state.uri.path,
        ref.read(userProvider)?.role,
      );
    },
  );
});
