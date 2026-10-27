import 'dart:math' as math;

import 'package:flutter/material.dart';

/// India's fixed dialling prefix, matching the existing authentication flow.
/// The flag is vector artwork so its appearance does not depend on emoji fonts.
class IndiaCallingCode extends StatelessWidget {
  const IndiaCallingCode({super.key});

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'India, country calling code +91',
    child: const ExcludeSemantics(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 24,
            height: 16,
            child: CustomPaint(painter: _IndiaFlagPainter()),
          ),
          SizedBox(width: 6),
          Text(
            '+91',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Color(0xFF111827),
            ),
          ),
          Icon(
            Icons.keyboard_arrow_down_rounded,
            size: 16,
            color: Color(0xFF9CA3AF),
          ),
        ],
      ),
    ),
  );
}

class AuthPhoneField extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String>? onSubmitted;
  final Color backgroundColor;
  final double borderRadius;

  const AuthPhoneField({
    super.key,
    required this.controller,
    this.onSubmitted,
    this.backgroundColor = const Color(0xFFF9FAFB),
    this.borderRadius = 14,
  });

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 56),
    decoration: BoxDecoration(
      color: backgroundColor,
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(color: const Color(0xFFE5E7EB), width: 1.5),
    ),
    padding: const EdgeInsets.symmetric(horizontal: 12),
    child: LayoutBuilder(
      builder: (context, constraints) {
        final scaler = MediaQuery.textScalerOf(context);
        double textWidth(String text, double size) {
          final painter = TextPainter(
            text: TextSpan(
              text: text,
              style: TextStyle(
                fontSize: size,
                fontFamily: Theme.of(context).textTheme.bodyMedium?.fontFamily,
              ),
            ),
            textScaler: scaler,
            textDirection: Directionality.of(context),
          )..layout();
          return painter.width;
        }

        // Reserve the full placeholder's measured width. Large accessibility text
        // gets a second row rather than squeezing the editable field or scaling down.
        final required =
            24 +
            6 +
            textWidth('+91', 14) +
            16 +
            17 +
            textWidth('Enter Phone Number', 15) +
            8;
        final stacked = constraints.maxWidth < required;
        final input = TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.telephoneNumberNational],
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Color(0xFF111827),
          ),
          decoration: InputDecoration(
            hintText: 'Enter Phone Number',
            hintMaxLines: stacked ? 2 : 1,
            hintStyle: const TextStyle(
              color: Color(0xFF9CA3AF),
              fontSize: 15,
              fontWeight: FontWeight.normal,
            ),
            border: InputBorder.none,
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(vertical: 16),
          ),
          onSubmitted: onSubmitted,
        );
        if (stacked) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 12, bottom: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: IndiaCallingCode(),
                ),
              ),
              const Divider(height: 1, color: Color(0xFFE5E7EB)),
              input,
            ],
          );
        }
        return Row(
          children: [
            const IndiaCallingCode(),
            const SizedBox(width: 8),
            Container(width: 1, height: 28, color: const Color(0xFFE5E7EB)),
            const SizedBox(width: 8),
            Expanded(child: input),
          ],
        );
      },
    ),
  );
}

class _IndiaFlagPainter extends CustomPainter {
  const _IndiaFlagPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final stripe = size.height / 3;
    final paint = Paint();
    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, stripe),
      paint..color = const Color(0xFFFF9933),
    );
    canvas.drawRect(
      Rect.fromLTWH(0, stripe, size.width, stripe),
      paint..color = Colors.white,
    );
    canvas.drawRect(
      Rect.fromLTWH(0, 2 * stripe, size.width, stripe),
      paint..color = const Color(0xFF138808),
    );
    final center = Offset(size.width / 2, size.height / 2);
    final radius = stripe * .43;
    paint
      ..color = const Color(0xFF000080)
      ..style = PaintingStyle.stroke
      ..strokeWidth = .5;
    canvas.drawCircle(center, radius, paint);
    for (var spoke = 0; spoke < 24; spoke++) {
      final angle = spoke * math.pi / 12;
      canvas.drawLine(
        center,
        center + Offset(math.cos(angle), math.sin(angle)) * radius,
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
