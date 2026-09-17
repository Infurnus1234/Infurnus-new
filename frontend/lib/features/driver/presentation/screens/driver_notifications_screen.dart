import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_card.dart';
import '../../../../shared/widgets/infurnus_loader.dart';
import '../../../auth/data/models/user_preferences_model.dart';
import '../../../auth/presentation/providers/user_provider.dart';
import '../providers/driver_providers.dart';

class DriverNotificationsScreen extends ConsumerStatefulWidget {
  const DriverNotificationsScreen({super.key});

  @override
  ConsumerState<DriverNotificationsScreen> createState() => _DriverNotificationsScreenState();
}

class _DriverNotificationsScreenState extends ConsumerState<DriverNotificationsScreen> {
  UserPreferencesModel? _preferences;
  List<UserHistoryModel> _history = [];
  bool _isLoading = false;
  bool _isSavingPref = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  Future<void> _loadData() async {
    final user = ref.read(userProvider);
    if (user == null) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final prefs = await ref.read(getUserPreferencesUseCaseProvider).execute(user.id);
      final historyList = await ref.read(getUserHistoryUseCaseProvider).execute(user.id);

      if (mounted) {
        setState(() {
          _isLoading = false;
          _preferences = prefs;
          _history = historyList;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  Future<void> _togglePreference(String key, bool value) async {
    final user = ref.read(userProvider);
    if (user == null || _preferences == null) return;

    setState(() => _isSavingPref = true);

    try {
      final updateData = {
        'pushNotificationsEnabled': key == 'push' ? value : _preferences!.pushNotificationsEnabled,
        'emailNotificationsEnabled': key == 'email' ? value : _preferences!.emailNotificationsEnabled,
        'smsNotificationsEnabled': key == 'sms' ? value : _preferences!.smsNotificationsEnabled,
      };

      final updated = await ref.read(updateUserPreferencesUseCaseProvider).execute(user.id, updateData);

      if (mounted) {
        setState(() {
          _isSavingPref = false;
          _preferences = updated;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSavingPref = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications & Activity'),
      ),
      body: _isLoading
          ? const InfurnusLoader(message: 'Loading Preferences & History...')
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_errorMessage != null) _buildErrorBanner(_errorMessage!),

                  // Notification Preferences Section
                  const Text('Notification Preferences', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  if (_preferences != null)
                    InfurnusCard(
                      child: Column(
                        children: [
                          SwitchListTile(
                            title: const Text('Push Notifications'),
                            subtitle: const Text('In-app & real-time alerts'),
                            value: _preferences!.pushNotificationsEnabled,
                            activeColor: AppColors.primaryGreen,
                            onChanged: _isSavingPref ? null : (val) => _togglePreference('push', val),
                          ),
                          const Divider(),
                          SwitchListTile(
                            title: const Text('Email Notifications'),
                            subtitle: const Text('Account & compliance updates'),
                            value: _preferences!.emailNotificationsEnabled,
                            activeColor: AppColors.primaryGreen,
                            onChanged: _isSavingPref ? null : (val) => _togglePreference('email', val),
                          ),
                          const Divider(),
                          SwitchListTile(
                            title: const Text('SMS Notifications'),
                            subtitle: const Text('Security & OTP notifications'),
                            value: _preferences!.smsNotificationsEnabled,
                            activeColor: AppColors.primaryGreen,
                            onChanged: _isSavingPref ? null : (val) => _togglePreference('sms', val),
                          ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 28),

                  // Real-Time Activity Log Section
                  const Text('Activity History', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('Audit trail of account events from backend.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  const SizedBox(height: 12),

                  if (_history.isEmpty)
                    const Center(child: Text('No activity history found.'))
                  else
                    ListView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: _history.length,
                      itemBuilder: (context, index) {
                        final item = _history[index];
                        return Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: InfurnusCard(
                            child: ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.history, color: AppColors.primaryGreen),
                              title: Text('${item.eventType} (${item.entityType})', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                              subtitle: Text('ID: ${item.entityId ?? "N/A"}\nAt: ${item.createdAt.toLocal()}'),
                            ),
                          ),
                        );
                      },
                    ),
                ],
              ),
            ),
    );
  }

  Widget _buildErrorBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.red[50],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red[200]!),
      ),
      child: Text(message, style: const TextStyle(color: Colors.red, fontSize: 13)),
    );
  }
}
