import 'package:infurnus/core/utils/currency_formatter.dart';
import 'package:flutter/material.dart';

import '../../data/models/fare_estimate_model.dart';

/// Displays backend-calculated components; contains no pricing calculations.
class FareRangeDetails extends StatelessWidget {
  final FareEstimateModel estimate;
  final Color textColor;
  const FareRangeDetails({
    super.key,
    required this.estimate,
    this.textColor = const Color(0xFF374151),
  });

  @override
  Widget build(BuildContext context) {
    String amount(double value) => '₹${value.rupeeText}';
    final min = estimate.minimum;
    final max = estimate.maximum;
    String range(double low, double? high) =>
        high == null ? '${amount(low)}+' : '${amount(low)}–${amount(high)}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (estimate.pricingDescription != null)
          Text(
            estimate.pricingDescription!,
            style: TextStyle(color: textColor, fontSize: 13),
          ),
        if (min != null) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Base Fare',
                  style: TextStyle(color: textColor, fontSize: 14),
                ),
                Text(
                  range(min.baseAmount, max?.baseAmount),
                  style: TextStyle(
                    color: textColor,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Distance (${estimate.distanceKm.toStringAsFixed(1)} km)',
                  style: TextStyle(color: textColor, fontSize: 14),
                ),
                Text(
                  range(min.distanceAmount, max?.distanceAmount),
                  style: TextStyle(
                    color: textColor,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Time', style: TextStyle(color: textColor, fontSize: 14)),
                Text(
                  amount(min.timeAmount),
                  style: TextStyle(
                    color: textColor,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
          if (min.waitingAmount != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Waiting',
                    style: TextStyle(color: textColor, fontSize: 14),
                  ),
                  Text(
                    amount(min.waitingAmount!),
                    style: TextStyle(
                      color: textColor,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          if (min.weightAmount != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Weight Surcharge',
                    style: TextStyle(color: textColor, fontSize: 14),
                  ),
                  Text(
                    amount(min.weightAmount!),
                    style: TextStyle(
                      color: textColor,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          if (min.loadingAmount != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Loading Assistance',
                    style: TextStyle(color: textColor, fontSize: 14),
                  ),
                  Text(
                    amount(min.loadingAmount!),
                    style: TextStyle(
                      color: textColor,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          if (min.taxAmount != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Taxes & Fees',
                    style: TextStyle(color: textColor, fontSize: 14),
                  ),
                  Text(
                    range(min.taxAmount!, max?.taxAmount),
                    style: TextStyle(
                      color: textColor,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
        ],
        if (estimate.bookingQuote != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'Configured booking quote: ${estimate.bookingQuote!.displayFare}',
              style: TextStyle(
                color: textColor,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
        if (estimate.message != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              estimate.message!,
              style: TextStyle(color: textColor, fontSize: 12),
            ),
          ),
      ],
    );
  }
}
