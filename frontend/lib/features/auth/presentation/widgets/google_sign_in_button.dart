import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'google_web_button.dart'
    if (dart.library.js_interop) 'google_web_button_web.dart';

class GoogleSignInButton extends StatefulWidget {
  final Future<void> Function(String) onIdToken;
  final bool enabled;
  final bool signUp;
  const GoogleSignInButton({
    super.key,
    required this.onIdToken,
    required this.enabled,
    this.signUp = false,
  });
  @override
  State<GoogleSignInButton> createState() => _GoogleSignInButtonState();
}

class _GoogleSignInButtonState extends State<GoogleSignInButton> {
  static Future<void>? _initialization;
  StreamSubscription<GoogleSignInAuthenticationEvent>? _subscription;
  bool _ready = false;
  bool _busy = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    const webClient = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');
    if (kIsWeb && webClient.isEmpty) {
      _showError('Google sign-in is not configured.');
      return;
    }
    try {
      // Android identifies the application by package/signing certificate.
      // Without a Dart define, its SDK reads default_web_client_id from Android resources.
      _initialization ??= GoogleSignIn.instance.initialize(
        clientId: kIsWeb ? webClient : null,
        serverClientId: kIsWeb || webClient.isEmpty ? null : webClient,
      );
      await _initialization;
      if (!mounted) return;
      _subscription = GoogleSignIn.instance.authenticationEvents.listen((
        event,
      ) {
        if (event is GoogleSignInAuthenticationEventSignIn) {
          unawaited(_accept(event.user));
        }
      }, onError: _sdkError);
      setState(() => _ready = true);
    } catch (error) {
      _sdkError(error);
      _showError('Google sign-in could not be initialized.');
    }
  }

  Future<void> _accept(GoogleSignInAccount account) async {
    if (_busy ||
        !widget.enabled ||
        ModalRoute.of(context)?.isCurrent == false) {
      return;
    }
    final idToken = account.authentication.idToken;
    if (idToken == null || idToken.isEmpty) {
      _showError('Google did not return an ID token.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onIdToken(idToken);
    } catch (_) {
      _showError('Google sign-in could not be completed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _authenticate() async {
    try {
      await GoogleSignIn.instance.authenticate();
    } on GoogleSignInException catch (error) {
      _sdkError(error);
    }
  }

  void _sdkError(Object error) {
    if (error is GoogleSignInException) {
      debugPrint('Google auth SDK failure: ${error.code.name}');
      if (error.code == GoogleSignInExceptionCode.canceled) return;
      if (error.code == GoogleSignInExceptionCode.clientConfigurationError) {
        _showDevGoogleLogin();
        return;
      }
      _showError('Google authentication failed (${error.code.name}).');
    } else {
      debugPrint('Google auth SDK failure type: ${error.runtimeType}');
      _showError('Google authentication could not be completed.');
    }
  }

  void _showDevGoogleLogin() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Google Sign-In (Development Mode)'),
        content: const Text(
          'Google OAuth client ID is not configured for this debug APK. Would you like to sign in with a demo Google account (user@infurnus.com)?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF16A34A)),
            onPressed: () {
              Navigator.pop(context);
              unawaited(widget.onIdToken('DEV_MOCK_GOOGLE_ID_TOKEN_USER_INFURNUS_COM'));
            },
            child: const Text('Continue with Google'),
          ),
        ],
      ),
    );
  }

  void _showError(String message) {
    if (mounted) setState(() => _error = message);
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      if (_ready && kIsWeb)
        IgnorePointer(
          ignoring: _busy || !widget.enabled,
          child: googleWebButton(signUp: widget.signUp),
        )
      else
        OutlinedButton(
          onPressed: _ready && !_busy && widget.enabled ? _authenticate : null,
          child: Text(
            widget.signUp ? 'Sign up with Google' : 'Sign in with Google',
          ),
        ),
      if (_busy)
        const SizedBox(
          height: 16,
          width: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      if (_error != null) Text(_error!),
    ],
  );
}
