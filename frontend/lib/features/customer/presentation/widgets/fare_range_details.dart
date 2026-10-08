import 'package:flutter/material.dart';

import '../../data/models/fare_estimate_model.dart';

/// Displays backend-calculated components; contains no pricing calculations.
class FareRangeDetails extends StatelessWidget {
  final FareEstimateModel estimate;
  const FareRangeDetails({super.key, required this.estimate});

  @override
  Widget build(BuildContext context) {
    String amount(double value) => '₹${value.toStringAsFixed(2)}';
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
            style: const TextStyle(color: Colors.white70),
          ),
        if (min != null) ...[
          Text(
            'Base: ${range(min.baseAmount, max?.baseAmount)}',
            style: const TextStyle(color: Colors.white70),
          ),
          Text(
            'Distance (${estimate.distanceKm.toStringAsFixed(1)} km): ${range(min.distanceAmount, max?.distanceAmount)}',
            style: const TextStyle(color: Colors.white70),
          ),
          Text(
            'Time: ${amount(min.timeAmount)}',
            style: const TextStyle(color: Colors.white70),
          ),
          if (min.waitingAmount != null)
            Text(
              'Waiting: ${amount(min.waitingAmount!)}',
              style: const TextStyle(color: Colors.white70),
            ),
          if (min.weightAmount != null)
            Text(
              'Weight: ${amount(min.weightAmount!)}',
              style: const TextStyle(color: Colors.white70),
            ),
          if (min.loadingAmount != null)
            Text(
              'Loading assistance: ${amount(min.loadingAmount!)}',
              style: const TextStyle(color: Colors.white70),
            ),
          if (min.taxAmount != null)
            Text(
              'Tax: ${range(min.taxAmount!, max?.taxAmount)}',
              style: const TextStyle(color: Colors.white70),
            ),
          const Text(
            'Approximate estimate; existing charges are included.',
            style: TextStyle(color: Colors.white70),
          ),
        ],
        if (estimate.bookingQuote != null)
          Text(
            'Configured booking quote: ${estimate.bookingQuote!.displayFare}',
            style: const TextStyle(color: Colors.white),
          ),
        if (estimate.message != null)
          Text(
            estimate.message!,
            style: const TextStyle(color: Colors.white70),
          ),
      ],
    );
  }
}
