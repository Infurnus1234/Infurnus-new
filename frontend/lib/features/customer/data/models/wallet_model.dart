class WalletModel {
  final String userId;
  final double balance;
  final int balancePaise;
  final String currency;
  final bool isActive;
  final int activityCount;

  const WalletModel({
    required this.userId,
    required this.balance,
    required this.balancePaise,
    required this.currency,
    required this.isActive,
    required this.activityCount,
  });

  factory WalletModel.fromJson(Map<String, dynamic> json) {
    final balancePaise = json['balancePaise'] is num
        ? (json['balancePaise'] as num).toInt()
        : 0;
    final balance = json['balance'] is num
        ? (json['balance'] as num).toDouble()
        : (balancePaise / 100.0);

    return WalletModel(
      userId: json['userId']?.toString() ?? '',
      balance: balance,
      balancePaise: balancePaise,
      currency: json['currency']?.toString() ?? 'INR',
      isActive: json['isActive'] == true || json['is_active'] == true,
      activityCount: json['activityCount'] is num
          ? (json['activityCount'] as num).toInt()
          : (json['activity_count'] is num
              ? (json['activity_count'] as num).toInt()
              : 0),
    );
  }

  factory WalletModel.empty() {
    return const WalletModel(
      userId: '',
      balance: 0.0,
      balancePaise: 0,
      currency: 'INR',
      isActive: true,
      activityCount: 0,
    );
  }

  WalletModel copyWith({
    String? userId,
    double? balance,
    int? balancePaise,
    String? currency,
    bool? isActive,
    int? activityCount,
  }) {
    return WalletModel(
      userId: userId ?? this.userId,
      balance: balance ?? this.balance,
      balancePaise: balancePaise ?? this.balancePaise,
      currency: currency ?? this.currency,
      isActive: isActive ?? this.isActive,
      activityCount: activityCount ?? this.activityCount,
    );
  }
}

class WalletTransactionModel {
  final String id;
  final String type; // 'credit' | 'debit'
  final double amount;
  final int amountPaise;
  final double balanceAfter;
  final int balanceAfterPaise;
  final String status; // 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED'
  final String paymentMethod;
  final String description;
  final String reference;
  final DateTime createdAt;
  final Map<String, dynamic>? metadata;

  const WalletTransactionModel({
    required this.id,
    required this.type,
    required this.amount,
    required this.amountPaise,
    required this.balanceAfter,
    required this.balanceAfterPaise,
    required this.status,
    required this.paymentMethod,
    required this.description,
    required this.reference,
    required this.createdAt,
    this.metadata,
  });

  factory WalletTransactionModel.fromJson(Map<String, dynamic> json) {
    final amountPaise = json['amountPaise'] is num
        ? (json['amountPaise'] as num).toInt()
        : ((json['amount_paise'] is num ? (json['amount_paise'] as num).toInt() : 0));
    final amount = json['amount'] is num
        ? (json['amount'] as num).toDouble()
        : (amountPaise / 100.0);

    final balanceAfterPaise = json['balanceAfterPaise'] is num
        ? (json['balanceAfterPaise'] as num).toInt()
        : ((json['balance_after_paise'] is num ? (json['balance_after_paise'] as num).toInt() : 0));
    final balanceAfter = json['balanceAfter'] is num
        ? (json['balanceAfter'] as num).toDouble()
        : (balanceAfterPaise / 100.0);

    final rawDate = json['createdAt']?.toString() ?? json['created_at']?.toString();
    final parsedDate = rawDate != null
        ? (DateTime.tryParse(rawDate)?.toLocal() ?? DateTime.now())
        : DateTime.now();

    return WalletTransactionModel(
      id: json['id']?.toString() ?? '',
      type: (json['type']?.toString().toLowerCase() == 'credit') ? 'credit' : 'debit',
      amount: amount,
      amountPaise: amountPaise,
      balanceAfter: balanceAfter,
      balanceAfterPaise: balanceAfterPaise,
      status: json['status']?.toString().toUpperCase() ?? 'PENDING',
      paymentMethod: json['paymentMethod']?.toString() ??
          json['payment_method']?.toString() ??
          'UPI',
      description: json['description']?.toString() ??
          (json['type'] == 'credit' ? 'Wallet Top-Up' : 'Payment Debit'),
      reference: json['reference']?.toString() ?? '',
      createdAt: parsedDate,
      metadata: json['metadata'] is Map ? Map<String, dynamic>.from(json['metadata'] as Map) : null,
    );
  }
}

class RecipientDetailsModel {
  final String targetId;
  final String targetType;
  final String displayName;
  final bool isVerified;
  final double? orderAmount;
  final int? orderAmountPaise;

  const RecipientDetailsModel({
    required this.targetId,
    required this.targetType,
    required this.displayName,
    required this.isVerified,
    this.orderAmount,
    this.orderAmountPaise,
  });

  factory RecipientDetailsModel.fromJson(Map<String, dynamic> json) {
    return RecipientDetailsModel(
      targetId: json['targetId']?.toString() ?? '',
      targetType: json['targetType']?.toString() ?? 'upi',
      displayName: json['displayName']?.toString() ?? json['targetId']?.toString() ?? '',
      isVerified: json['isVerified'] == true,
      orderAmount: (json['orderAmount'] as num?)?.toDouble(),
      orderAmountPaise: (json['orderAmountPaise'] as num?)?.toInt(),
    );
  }
}
