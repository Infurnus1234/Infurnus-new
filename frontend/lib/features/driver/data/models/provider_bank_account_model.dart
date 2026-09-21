class ProviderBankAccountModel {
  final String id;
  final String userId;
  final String accountHolderName;
  final String accountNumberMasked;
  final String accountNumberLast4;
  final String ifscCode;
  final String bankName;
  final String? upiId;
  final bool isVerified;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  ProviderBankAccountModel({
    required this.id,
    required this.userId,
    required this.accountHolderName,
    required this.accountNumberMasked,
    required this.accountNumberLast4,
    required this.ifscCode,
    required this.bankName,
    this.upiId,
    required this.isVerified,
    this.createdAt,
    this.updatedAt,
  });

  factory ProviderBankAccountModel.fromJson(Map<String, dynamic> json) {
    return ProviderBankAccountModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      accountHolderName: json['accountHolderName'] as String? ?? '',
      accountNumberMasked: json['accountNumberMasked'] as String? ?? '••••••••',
      accountNumberLast4: json['accountNumberLast4'] as String? ?? '',
      ifscCode: json['ifscCode'] as String? ?? '',
      bankName: json['bankName'] as String? ?? '',
      upiId: json['upiId'] as String?,
      isVerified: json['isVerified'] as bool? ?? false,
      createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt'] as String) : null,
      updatedAt: json['updatedAt'] != null ? DateTime.parse(json['updatedAt'] as String) : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'userId': userId,
        'accountHolderName': accountHolderName,
        'accountNumberMasked': accountNumberMasked,
        'accountNumberLast4': accountNumberLast4,
        'ifscCode': ifscCode,
        'bankName': bankName,
        'upiId': upiId,
        'isVerified': isVerified,
      };
}
