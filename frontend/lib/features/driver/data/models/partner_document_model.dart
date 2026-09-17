class PartnerDocumentModel {
  final String id;
  final String partnerId;
  final String? vehicleId;
  final String type; // documentType
  final String status;
  final String? issuedAt;
  final String? expiresAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  PartnerDocumentModel({
    required this.id,
    required this.partnerId,
    this.vehicleId,
    required this.type,
    required this.status,
    this.issuedAt,
    this.expiresAt,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PartnerDocumentModel.fromJson(Map<String, dynamic> json) {
    return PartnerDocumentModel(
      id: json['id'] as String,
      partnerId: json['partnerId'] as String,
      vehicleId: json['vehicleId'] as String?,
      type: (json['documentType'] ?? json['type'] ?? '') as String,
      status: json['status'] as String,
      issuedAt: json['issuedAt'] as String?,
      expiresAt: json['expiresAt'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'partnerId': partnerId,
        'vehicleId': vehicleId,
        'documentType': type,
        'status': status,
        'issuedAt': issuedAt,
        'expiresAt': expiresAt,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };
}
