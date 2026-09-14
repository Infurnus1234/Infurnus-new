class PartnerModel {
  final String id;
  final String userId;
  final String businessName;
  final String? businessDescription;
  final String approvalStatus; // pending, under_review, approved, rejected
  final String availabilityStatus; // offline, available, unavailable
  final DateTime createdAt;
  final DateTime updatedAt;

  PartnerModel({
    required this.id,
    required this.userId,
    required this.businessName,
    this.businessDescription,
    required this.approvalStatus,
    required this.availabilityStatus,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PartnerModel.fromJson(Map<String, dynamic> json) {
    return PartnerModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      businessName: json['businessName'] as String,
      businessDescription: json['businessDescription'] as String?,
      approvalStatus: json['approvalStatus'] as String,
      availabilityStatus: json['availabilityStatus'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'userId': userId,
        'businessName': businessName,
        'businessDescription': businessDescription,
        'approvalStatus': approvalStatus,
        'availabilityStatus': availabilityStatus,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };
}
