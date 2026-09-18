class SupportTicketModel {
  final String id;
  final String ticketNumber;
  final String userId;
  final String role;
  final String category;
  final String subject;
  final String message;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  SupportTicketModel({
    required this.id,
    required this.ticketNumber,
    required this.userId,
    required this.role,
    required this.category,
    required this.subject,
    required this.message,
    required this.status,
    this.createdAt,
    this.updatedAt,
  });

  factory SupportTicketModel.fromJson(Map<String, dynamic> json) {
    return SupportTicketModel(
      id: json['id'] as String,
      ticketNumber: json['ticketNumber'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      role: json['role'] as String? ?? '',
      category: json['category'] as String? ?? 'General',
      subject: json['subject'] as String? ?? '',
      message: json['message'] as String? ?? '',
      status: json['status'] as String? ?? 'OPEN',
      createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt'] as String) : null,
      updatedAt: json['updatedAt'] != null ? DateTime.parse(json['updatedAt'] as String) : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ticketNumber': ticketNumber,
        'userId': userId,
        'role': role,
        'category': category,
        'subject': subject,
        'message': message,
        'status': status,
      };
}
