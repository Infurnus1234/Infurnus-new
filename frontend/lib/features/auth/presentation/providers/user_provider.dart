import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/user.dart';

class UserNotifier extends StateNotifier<User?> {
  UserNotifier() : super(null);

  void setUser(User user) {
    state = user;
  }

  void switchRole() {
    if (state == null) return;
    final newRole = state!.role == 'customer' ? 'driver' : 'customer';
    state = User(
      id: state!.id,
      firstName: state!.firstName,
      lastName: state!.lastName,
      email: state!.email,
      phone: state!.phone,
      role: newRole,
      createdAt: state!.createdAt,
      updatedAt: state!.updatedAt,
    );
  }

  void logout() {
    state = null;
  }
}

final userProvider = StateNotifierProvider<UserNotifier, User?>((ref) {
  return UserNotifier();
});
