class UserPreferencesModel {
  final String userId;
  final bool pushNotificationsEnabled;
  final bool emailNotificationsEnabled;
  final bool smsNotificationsEnabled;

  UserPreferencesModel({
    required this.userId,
    required this.pushNotificationsEnabled,
    required this.emailNotificationsEnabled,
    required this.smsNotificationsEnabled,
  });

  factory UserPreferencesModel.fromJson(Map<String, dynamic> json) {
    return UserPreferencesModel(
      userId: json['userId'] as String,
      pushNotificationsEnabled: json['pushNotificationsEnabled'] as bool? ?? true,
      emailNotificationsEnabled: json['emailNotificationsEnabled'] as bool? ?? true,
      smsNotificationsEnabled: json['smsNotificationsEnabled'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
        'userId': userId,
        'pushNotificationsEnabled': pushNotificationsEnabled,
        'emailNotificationsEnabled': emailNotificationsEnabled,
        'smsNotificationsEnabled': smsNotificationsEnabled,
      };
}

class UserHistoryModel {
  final String id;
  final String userId;
  final String eventType;
  final String entityType;
  final String? entityId;
  final DateTime createdAt;

  UserHistoryModel({
    required this.id,
    required this.userId,
    required this.eventType,
    required this.entityType,
    this.entityId,
    required this.createdAt,
  });

  factory UserHistoryModel.fromJson(Map<String, dynamic> json) {
    return UserHistoryModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      eventType: json['eventType'] as String,
      entityType: json['entityType'] as String,
      entityId: json['entityId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}
