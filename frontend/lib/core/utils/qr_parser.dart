import 'dart:convert';

enum QrPayloadType {
  upi,
  infurnusDriver,
  infurnusMerchant,
  infurnusLogisticsOrder,
  invalid,
}

class QrPaymentPayload {
  final QrPayloadType type;
  final bool isValid;
  final String? payeeVpa;
  final String? payeeName;
  final double? amount;
  final int? amountPaise;
  final bool isAmountFixed;
  final String? reference;
  final String? note;
  final String? targetId;
  final String? orderId;
  final String? errorMessage;
  final String rawContent;

  const QrPaymentPayload({
    required this.type,
    required this.isValid,
    required this.rawContent,
    this.payeeVpa,
    this.payeeName,
    this.amount,
    this.amountPaise,
    this.isAmountFixed = false,
    this.reference,
    this.note,
    this.targetId,
    this.orderId,
    this.errorMessage,
  });

  factory QrPaymentPayload.invalid(String raw, String error) {
    return QrPaymentPayload(
      type: QrPayloadType.invalid,
      isValid: false,
      rawContent: raw,
      errorMessage: error,
    );
  }
}

class QrParser {
  QrParser._();

  static final RegExp _upiIdRegex = RegExp(
    r'^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$',
  );

  /// Validates standard UPI ID / VPA string format
  static bool isValidUpiId(String input) {
    final clean = input.trim();
    return _upiIdRegex.hasMatch(clean);
  }

  /// Parses any scanned QR code content string
  static QrPaymentPayload parse(String? raw) {
    if (raw == null || raw.trim().isEmpty) {
      return QrPaymentPayload.invalid('', 'Empty QR code scanned');
    }

    final trimmed = raw.trim();

    // 1. Standard UPI URI: upi://pay?pa=...&pn=...&am=...
    if (trimmed.toLowerCase().startsWith('upi://pay')) {
      return _parseUpiUri(trimmed);
    }

    // 2. Infurnus URI scheme: infurnus://...
    if (trimmed.toLowerCase().startsWith('infurnus://')) {
      return _parseInfurnusUri(trimmed);
    }

    // 3. JSON format: {"type":"infurnus_driver", ...}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return _parseJsonPayload(trimmed);
    }

    // 4. Plain UPI ID: e.g. driver@ybl
    if (_upiIdRegex.hasMatch(trimmed)) {
      final name = trimmed.split('@')[0].toUpperCase();
      return QrPaymentPayload(
        type: QrPayloadType.upi,
        isValid: true,
        rawContent: trimmed,
        payeeVpa: trimmed,
        payeeName: name,
        targetId: trimmed,
        isAmountFixed: false,
      );
    }

    // 5. Prefixed Infurnus formats: INFURNUS:DRIVER:... or INFURNUS:MERCHANT:...
    if (trimmed.toUpperCase().startsWith('INFURNUS:')) {
      return _parseColonFormat(trimmed);
    }

    return QrPaymentPayload.invalid(
      trimmed,
      'Unsupported QR code format. Please scan a valid UPI or INFURNUS payment QR.',
    );
  }

  static QrPaymentPayload _parseUpiUri(String uriString) {
    try {
      final uri = Uri.parse(uriString);
      final params = uri.queryParameters;
      final pa = params['pa']?.trim();

      if (pa == null || pa.isEmpty) {
        return QrPaymentPayload.invalid(uriString, 'UPI QR missing payee address (pa)');
      }

      if (!_upiIdRegex.hasMatch(pa)) {
        return QrPaymentPayload.invalid(uriString, 'Invalid UPI ID in QR: $pa');
      }

      final pn = params['pn'] != null ? Uri.decodeComponent(params['pn']!) : pa.split('@')[0].toUpperCase();
      final amStr = params['am']?.trim();
      double? amount;
      int? amountPaise;
      bool isAmountFixed = false;

      if (amStr != null && amStr.isNotEmpty) {
        amount = double.tryParse(amStr);
        if (amount != null && amount > 0) {
          amountPaise = (amount * 100).round();
          isAmountFixed = true;
        }
      }

      return QrPaymentPayload(
        type: QrPayloadType.upi,
        isValid: true,
        rawContent: uriString,
        payeeVpa: pa,
        payeeName: pn,
        amount: amount,
        amountPaise: amountPaise,
        isAmountFixed: isAmountFixed,
        reference: params['tr'] ?? params['tid'],
        note: params['tn'],
        targetId: pa,
      );
    } catch (e) {
      return QrPaymentPayload.invalid(uriString, 'Malformed UPI QR code');
    }
  }

  static QrPaymentPayload _parseInfurnusUri(String uriString) {
    try {
      final uri = Uri.parse(uriString);
      final host = uri.host.toLowerCase();
      final params = uri.queryParameters;

      if (host == 'logistics' || host == 'order') {
        final orderId = params['orderId'] ?? params['id'] ?? uri.pathSegments.firstOrNull;
        if (orderId == null || orderId.isEmpty) {
          return QrPaymentPayload.invalid(uriString, 'Logistics QR missing order reference');
        }
        final amStr = params['amount'];
        final amount = amStr != null ? double.tryParse(amStr) : null;
        final amountPaise = amount != null ? (amount * 100).round() : null;

        return QrPaymentPayload(
          type: QrPayloadType.infurnusLogisticsOrder,
          isValid: true,
          rawContent: uriString,
          orderId: orderId,
          targetId: orderId,
          payeeName: params['name'] ?? 'INFURNUS Logistics Delivery',
          amount: amount,
          amountPaise: amountPaise,
          isAmountFixed: amount != null && amount > 0,
          note: params['note'] ?? 'Logistics Order Balance',
        );
      }

      if (host == 'driver') {
        final driverId = params['id'] ?? params['driverId'] ?? uri.pathSegments.firstOrNull;
        if (driverId == null || driverId.isEmpty) {
          return QrPaymentPayload.invalid(uriString, 'Driver QR missing driver ID');
        }
        final amStr = params['amount'];
        final amount = amStr != null ? double.tryParse(amStr) : null;

        return QrPaymentPayload(
          type: QrPayloadType.infurnusDriver,
          isValid: true,
          rawContent: uriString,
          targetId: driverId,
          payeeName: params['name'] ?? 'INFURNUS Partner Driver',
          amount: amount,
          amountPaise: amount != null ? (amount * 100).round() : null,
          isAmountFixed: amount != null && amount > 0,
          note: params['note'] ?? 'Driver Trip Payment',
        );
      }

      if (host == 'merchant') {
        final code = params['code'] ?? params['merchantCode'] ?? uri.pathSegments.firstOrNull;
        if (code == null || code.isEmpty) {
          return QrPaymentPayload.invalid(uriString, 'Merchant QR missing merchant code');
        }
        return QrPaymentPayload(
          type: QrPayloadType.infurnusMerchant,
          isValid: true,
          rawContent: uriString,
          targetId: code,
          payeeName: params['name'] ?? 'INFURNUS Merchant: $code',
          isAmountFixed: false,
        );
      }

      return QrPaymentPayload.invalid(uriString, 'Unsupported INFURNUS QR action: $host');
    } catch (e) {
      return QrPaymentPayload.invalid(uriString, 'Malformed INFURNUS QR code');
    }
  }

  static QrPaymentPayload _parseJsonPayload(String jsonStr) {
    try {
      final Map<String, dynamic> data = jsonDecode(jsonStr);
      final type = data['type']?.toString().toLowerCase();

      if (type == 'infurnus_logistics' || type == 'order') {
        final orderId = data['orderId']?.toString();
        if (orderId == null || orderId.isEmpty) {
          return QrPaymentPayload.invalid(jsonStr, 'Missing orderId in JSON');
        }
        final double? amt = (data['amount'] as num?)?.toDouble();
        return QrPaymentPayload(
          type: QrPayloadType.infurnusLogisticsOrder,
          isValid: true,
          rawContent: jsonStr,
          orderId: orderId,
          targetId: orderId,
          payeeName: data['name']?.toString() ?? 'INFURNUS Logistics Delivery',
          amount: amt,
          amountPaise: amt != null ? (amt * 100).round() : null,
          isAmountFixed: amt != null && amt > 0,
          note: data['note']?.toString(),
        );
      }

      if (type == 'infurnus_driver') {
        final driverId = data['driverId']?.toString();
        if (driverId == null || driverId.isEmpty) {
          return QrPaymentPayload.invalid(jsonStr, 'Missing driverId in JSON');
        }
        final double? amt = (data['amount'] as num?)?.toDouble();
        return QrPaymentPayload(
          type: QrPayloadType.infurnusDriver,
          isValid: true,
          rawContent: jsonStr,
          targetId: driverId,
          payeeName: data['name']?.toString() ?? 'INFURNUS Partner Driver',
          amount: amt,
          amountPaise: amt != null ? (amt * 100).round() : null,
          isAmountFixed: amt != null && amt > 0,
        );
      }

      if (type == 'infurnus_merchant') {
        final merchantCode = data['merchantCode']?.toString();
        if (merchantCode == null || merchantCode.isEmpty) {
          return QrPaymentPayload.invalid(jsonStr, 'Missing merchantCode in JSON');
        }
        return QrPaymentPayload(
          type: QrPayloadType.infurnusMerchant,
          isValid: true,
          rawContent: jsonStr,
          targetId: merchantCode,
          payeeName: data['name']?.toString() ?? 'Merchant: $merchantCode',
          isAmountFixed: false,
        );
      }

      return QrPaymentPayload.invalid(jsonStr, 'Unsupported JSON payload type: $type');
    } catch (_) {
      return QrPaymentPayload.invalid(jsonStr, 'Invalid JSON QR content');
    }
  }

  static QrPaymentPayload _parseColonFormat(String input) {
    final parts = input.split(':');
    if (parts.length >= 3) {
      final category = parts[1].toUpperCase();
      final id = parts[2];
      if (category == 'DRIVER') {
        final double? amt = parts.length >= 4 ? double.tryParse(parts[3]) : null;
        return QrPaymentPayload(
          type: QrPayloadType.infurnusDriver,
          isValid: true,
          rawContent: input,
          targetId: id,
          payeeName: 'INFURNUS Partner Driver',
          amount: amt,
          amountPaise: amt != null ? (amt * 100).round() : null,
          isAmountFixed: amt != null && amt > 0,
        );
      }
      if (category == 'MERCHANT') {
        return QrPaymentPayload(
          type: QrPayloadType.infurnusMerchant,
          isValid: true,
          rawContent: input,
          targetId: id,
          payeeName: 'Merchant: $id',
          isAmountFixed: false,
        );
      }
    }
    return QrPaymentPayload.invalid(input, 'Invalid INFURNUS code structure');
  }
}
