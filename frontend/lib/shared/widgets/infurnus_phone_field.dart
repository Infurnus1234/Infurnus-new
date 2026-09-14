import 'package:flutter/material.dart';
import 'infurnus_text_field.dart';

class InfurnusPhoneField extends StatelessWidget {
  final TextEditingController? controller;
  const InfurnusPhoneField({super.key, this.controller});

  @override
  Widget build(BuildContext context) {
    return InfurnusTextField(
      label: 'Phone Number',
      hintText: '99999 99999',
      controller: controller,
      keyboardType: TextInputType.phone,
      prefixIcon: Icons.phone_android,
    );
  }
}
