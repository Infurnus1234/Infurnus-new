import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';

class GoogleSignInButton extends StatefulWidget {
  final Future<void> Function(String) onIdToken;
  final bool enabled;
  final bool signUp;
  final ButtonStyle? style;
  final Widget? child;

  const GoogleSignInButton({
    super.key,
    required this.onIdToken,
    required this.enabled,
    this.signUp = false,
    this.style,
    this.child,
  });

  @override
  State<GoogleSignInButton> createState() => _GoogleSignInButtonState();
}

class _GoogleSignInButtonState extends State<GoogleSignInButton> {
  static Future<void>? _initialization;
  StreamSubscription<GoogleSignInAuthenticationEvent>? _subscription;
  bool _busy = false;
  bool _launching = false;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    const webClient = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');
    try {
      _initialization ??= GoogleSignIn.instance.initialize(
        clientId: kIsWeb && webClient.isNotEmpty ? webClient : null,
        serverClientId: kIsWeb || webClient.isEmpty ? null : webClient,
      );
      await _initialization;
      if (!mounted) return;
      _subscription = GoogleSignIn.instance.authenticationEvents.listen((
        event,
      ) {
        if (kIsWeb && event is GoogleSignInAuthenticationEventSignIn) {
          unawaited(_accept(event.user));
        }
      }, onError: _showError);
    } catch (error) {
      _showError(error);
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
      _showError(StateError('Google did not return an ID token.'));
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.onIdToken(idToken);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _authenticate() async {
    if (_launching || _busy || !widget.enabled) return;
    setState(() => _launching = true);
    try {
      await _initialization;
      final account = await GoogleSignIn.instance.authenticate();
      if (mounted) await _accept(account);
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  void _showError(Object error) {
    if (!mounted) return;
    final message =
        error is GoogleSignInException &&
            error.code == GoogleSignInExceptionCode.canceled
        ? 'Google sign-in was canceled. Please try again.'
        : 'Google sign-in could not be completed. Please try again.';
    debugPrint('Google auth SDK failure type: ${error.runtimeType}');
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.signUp ? 'Sign up with Google' : 'Sign in with Google';

    return SizedBox(
      width: double.infinity,
      height: 52,
      child: OutlinedButton(
        onPressed: !_busy && !_launching && widget.enabled
            ? _authenticate
            : null,
        style:
            widget.style ??
            OutlinedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: const Color(0xFF0B0B0B),
              side: const BorderSide(color: Color(0xFF0B0B0B), width: 1.2),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              elevation: 0,
            ),
        child:
            widget.child ??
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 24,
                  height: 24,
                  decoration: const BoxDecoration(shape: BoxShape.circle),
                  child: Image.network(
                    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/1200px-Google_%22G%22_logo.svg.png',
                    width: 22,
                    height: 22,
                    errorBuilder: (_, __, ___) => const Icon(
                      Icons.g_mobiledata_rounded,
                      color: Color(0xFF4285F4),
                      size: 24,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  text,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF0B0B0B),
                  ),
                ),
              ],
            ),
      ),
    );
  }
}
