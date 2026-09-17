class User {
  final String id;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final String role;
  final DateTime createdAt;
  final DateTime updatedAt;

  User({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
    required this.role,
    required this.createdAt,
    required this.updatedAt,
  });

  String get name => '$firstName $lastName'.trim();
  bool get isApprovedDriver => role == 'driver';
  String get fullName => '$firstName $lastName';
}
