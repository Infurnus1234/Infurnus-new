import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../auth/presentation/providers/auth_provider.dart';

class DeleteAccountScreen extends ConsumerWidget {
  const DeleteAccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delete Account')),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.warning_amber_rounded, color: Colors.red, size: 64),
            const SizedBox(height: 24),
            const Text(
              'Are you sure you want to delete your account?',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            const Text(
              'This action is permanent and cannot be undone. You will lose access to your ride history, wallet balance, and profile data.',
              style: TextStyle(fontSize: 16, color: Colors.grey),
            ),
            const Spacer(),
            InfurnusButton(
              text: 'Confirm Deletion',
              onPressed: () async {
                // Mock backend deletion call
                await ref.read(authProvider.notifier).logout();
                if (context.mounted) context.go('/login');
              },
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: () => context.pop(),
                child: const Text('Cancel', style: TextStyle(color: AppColors.textPrimary)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
