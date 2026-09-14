class PartnerDocumentModel {
  final String id;
  final String partnerId;
  final String type; // e.g., 'driving_license', 'rc', 'insurance'
  final String status; // 'pending', 'approved', 'rejected'
  final String? documentKey;
  final String? rejectionReason;
  final DateTime createdAt;
  final DateTime updatedAt;

  PartnerDocumentModel({
    required this.id,
    required this.partnerId,
    required this.type,
    required this.status,
    this.documentKey,
    this.rejectionReason,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PartnerDocumentModel.fromJson(Map<String, dynamic> json) {
    return PartnerDocumentModel(
      id: json['id'] as String,
      partnerId: json['partnerId'] as String,
      type: json['type'] as String,
      status: json['status'] as String,
      documentKey: json['documentKey'] as String?,
      rejectionReason: json['rejectionReason'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'partnerId': partnerId,
        'type': type,
        'status': status,
        'documentKey': documentKey,
        'rejectionReason': rejectionReason,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };
}
