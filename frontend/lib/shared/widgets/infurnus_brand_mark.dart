import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

class InfurnusBrandMark extends StatelessWidget {
  final double iconSize;
  final double fontSize;
  final Color textColor;
  final bool showText;
  final double spacing;

  const InfurnusBrandMark({
    super.key,
    this.iconSize = 36.0,
    this.fontSize = 22.0,
    this.textColor = Colors.black,
    this.showText = true,
    this.spacing = 10.0,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: iconSize,
          height: iconSize,
          decoration: BoxDecoration(
            color: Colors.black,
            borderRadius: BorderRadius.circular(iconSize * 0.22),
            boxShadow: [
              BoxShadow(
                color: AppColors.emeraldNeon.withValues(alpha: 0.38),
                blurRadius: iconSize * 0.35,
                spreadRadius: 0.5,
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Image.asset(
            'assets/images/logo.jpg',
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) => Container(
              color: AppColors.primaryGreen,
              alignment: Alignment.center,
              child: Text(
                'N',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: iconSize * 0.58,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0,
                  height: 1.0,
                ),
              ),
            ),
          ),
        ),
        if (showText) ...[
          SizedBox(width: spacing),
          Text(
            'INFURNUS',
            style: TextStyle(
              color: textColor,
              fontSize: fontSize,
              fontWeight: FontWeight.w900,
              letterSpacing: 2.0,
            ),
          ),
        ],
      ],
    );
  }
}
