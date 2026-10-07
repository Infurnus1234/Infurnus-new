import 'package:flutter/widgets.dart';
import 'package:google_sign_in_web/web_only.dart' as web;

Widget googleWebButton({bool signUp = false}) => web.renderButton(
  configuration: web.GSIButtonConfiguration(
    text: signUp ? web.GSIButtonText.signupWith : web.GSIButtonText.signinWith,
  ),
);
