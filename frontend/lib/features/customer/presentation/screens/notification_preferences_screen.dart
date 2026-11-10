import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends State<NotificationPreferencesScreen>
    with WidgetsBindingObserver {
  static const Color mainBg = Color(0xFFF8FAFC);
  static const Color cardBg = Color(0xFFFFFFFF);
  static const Color borderCard = Color(0xFFE2E8F0);
  static const Color textBlack = Color(0xFF0F172A);
  static const Color textGray = Color(0xFF64748B);
  static const Color brandGreen = Color(0xFF10B981);
  static const Color alertAmber = Color(0xFFD97706);
  static const Color serviceRed = Color(0xFFEF4444);

  PermissionStatus _permissionStatus = PermissionStatus.denied;
  bool _isLoading = false;

  bool _rideAlerts = true;
  bool _safetyAlerts = true;
  bool _offersAlerts = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkPermission();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkPermission();
    }
  }

  Future<void> _checkPermission() async {
    try {
      final status = await Permission.notification.status;
      if (mounted) {
        setState(() {
          _permissionStatus = status;
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _requestPermission() async {
    try {
      final result = await Permission.notification.request();
      if (mounted) {
        setState(() => _permissionStatus = result);
      }
    } catch (_) {}
  }

  Future<void> _openSettings() async {
    await openAppSettings();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: mainBg,
      appBar: AppBar(
        backgroundColor: cardBg,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: textBlack),
          onPressed: () => context.pop(),
        ),
        title: const Text(
          'Notification Preferences',
          style: TextStyle(
            color: textBlack,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: borderCard),
        ),
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: brandGreen))
            : SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildPermissionStatusCard(),
                    const SizedBox(height: 20),
                    const Text(
                      'Alert Categories',
                      style: TextStyle(
                        color: textBlack,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _buildPreferencesCard(),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildPermissionStatusCard() {
    final isGranted = _permissionStatus.isGranted;
    final isPermanentlyDenied =
        _permissionStatus.isPermanentlyDenied || _permissionStatus.isRestricted;

    Color badgeColor;
    Color iconBg;
    IconData iconData;
    String title;
    String description;

    if (isGranted) {
      badgeColor = brandGreen;
      iconBg = brandGreen.withValues(alpha: 0.12);
      iconData = Icons.notifications_active_rounded;
      title = 'Notifications Active';
      description = 'You are receiving live ride updates, driver arrival alerts, and critical security OTPs.';
    } else if (isPermanentlyDenied) {
      badgeColor = serviceRed;
      iconBg = serviceRed.withValues(alpha: 0.12);
      iconData = Icons.notifications_off_rounded;
      title = 'Notifications Blocked';
      description = 'Notifications are blocked in your device settings. Open settings to re-enable them for ride updates.';
    } else {
      badgeColor = alertAmber;
      iconBg = alertAmber.withValues(alpha: 0.12);
      iconData = Icons.notifications_paused_rounded;
      title = 'Notifications Disabled';
      description = 'Enable push notifications to receive real-time driver updates and booking confirmations.';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderCard),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(iconData, color: badgeColor, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: textBlack,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      isGranted ? 'Permission Granted' : 'Action Required',
                      style: TextStyle(
                        color: badgeColor,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            description,
            style: const TextStyle(color: textGray, fontSize: 13, height: 1.4),
          ),
          if (!isGranted) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              height: 44,
              child: ElevatedButton.icon(
                onPressed: isPermanentlyDenied
                    ? _openSettings
                    : _requestPermission,
                icon: Icon(
                  isPermanentlyDenied
                      ? Icons.settings_rounded
                      : Icons.notifications_rounded,
                  size: 18,
                ),
                label: Text(
                  isPermanentlyDenied
                      ? 'Open Device Settings'
                      : 'Enable Notifications',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isPermanentlyDenied ? textBlack : brandGreen,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPreferencesCard() {
    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderCard),
      ),
      child: Column(
        children: [
          _buildToggleTile(
            title: 'Trip & Ride Status',
            subtitle: 'Live vehicle tracking, driver arrival, trip updates',
            icon: Icons.directions_car_rounded,
            value: _rideAlerts,
            onChanged: (val) => setState(() => _rideAlerts = val),
          ),
          const Divider(height: 1, color: borderCard),
          _buildToggleTile(
            title: 'Safety & Security Alerts',
            subtitle: 'Emergency SOS alerts, pickup PIN, security updates',
            icon: Icons.security_rounded,
            value: _safetyAlerts,
            onChanged: (val) => setState(() => _safetyAlerts = val),
          ),
          const Divider(height: 1, color: borderCard),
          _buildToggleTile(
            title: 'Offers & Promotions',
            subtitle: 'Exclusive discounts, festival vouchers, promo codes',
            icon: Icons.local_offer_outlined,
            value: _offersAlerts,
            onChanged: (val) => setState(() => _offersAlerts = val),
          ),
        ],
      ),
    );
  }

  Widget _buildToggleTile({
    required String title,
    required String subtitle,
    required IconData icon,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Icon(icon, color: textGray, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                    color: textBlack,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(color: textGray, fontSize: 11),
                ),
              ],
            ),
          ),
          Switch.adaptive(
            value: value,
            activeThumbColor: brandGreen,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}
