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
            color: AppColors.primaryGreen,
            borderRadius: BorderRadius.circular(iconSize * 0.28),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryGreen.withValues(alpha: 0.3),
                blurRadius: iconSize * 0.35,
                offset: Offset(0, iconSize * 0.12),
              ),
            ],
          ),
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
