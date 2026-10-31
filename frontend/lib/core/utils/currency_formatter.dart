import 'package:intl/intl.dart';

/// Single shared helper for Indian Rupee currency formatting and paise math.
class CurrencyFormatter {
  CurrencyFormatter._();

  static final NumberFormat _inrFormatter = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: 2,
  );

  static final NumberFormat _inrNoSymbolFormatter = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '',
    decimalDigits: 2,
  );

  /// Formats a rupee amount with Indian numbering system: e.g. ₹1,23,456.78
  static String format(num? amount, {bool showSymbol = true}) {
    if (amount == null || amount.isNaN) {
      return showSymbol ? '₹0.00' : '0.00';
    }
    final formatted = showSymbol
        ? _inrFormatter.format(amount)
        : _inrNoSymbolFormatter.format(amount).trim();
    return formatted;
  }

  /// Formats an integer amount in paise: e.g. 50000 paise -> ₹500.00
  static String formatPaise(int? paise, {bool showSymbol = true}) {
    if (paise == null) return showSymbol ? '₹0.00' : '0.00';
    final rupees = paise / 100.0;
    return format(rupees, showSymbol: showSymbol);
  }

  /// Converts rupees to integer paise without floating-point inaccuracies
  static int rupeesToPaise(num? rupees) {
    if (rupees == null || rupees.isNaN || rupees <= 0) return 0;
    return (rupees * 100).round();
  }

  /// Converts integer paise to double rupees
  static double paiseToRupees(int? paise) {
    if (paise == null || paise <= 0) return 0.0;
    return paise / 100.0;
  }
}
