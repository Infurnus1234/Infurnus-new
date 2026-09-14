import 'package:flutter/material.dart';
import 'infurnus_text_field.dart';

class InfurnusOtpField extends StatelessWidget {
  final TextEditingController? controller;
  const InfurnusOtpField({super.key, this.controller});

  @override
  Widget build(BuildContext context) {
    return InfurnusTextField(
      label: 'OTP Code',
      hintText: '123456',
      controller: controller,
      keyboardType: TextInputType.number,
      prefixIcon: Icons.lock_outline,
    );
  }
}
