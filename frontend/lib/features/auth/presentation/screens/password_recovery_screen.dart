import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/auth_models.dart';
import '../providers/auth_use_case_providers.dart';

class PasswordRecoveryScreen extends ConsumerStatefulWidget {
  const PasswordRecoveryScreen({super.key, this.initialEmail = ''});
  final String initialEmail;
  @override
  ConsumerState<PasswordRecoveryScreen> createState() =>
      _PasswordRecoveryScreenState();
}

class _PasswordRecoveryScreenState
    extends ConsumerState<PasswordRecoveryScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _email;
  final _otp = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  PasswordRecoverySession? _session;
  bool _verified = false;
  bool _busy = false;
  String? _error;
  DateTime? _resendAfter;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: widget.initialEmail);
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _session != null) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final controller in [_email, _otp, _password, _confirmation]) {
      controller.dispose();
    }
    super.dispose();
  }

  bool get _expired =>
      _session != null && !_session!.expiresAt.isAfter(DateTime.now());
  int get _resendSeconds => _resendAfter == null
      ? 0
      : (_resendAfter!.difference(DateTime.now()).inSeconds + 1).clamp(0, 30);

  Future<void> _submit({bool resend = false}) async {
    if (_busy || (!resend && !_form.currentState!.validate())) return;
    if (resend && _resendSeconds > 0) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final recovery = ref.read(passwordRecoveryUseCaseProvider);
      if (_session == null || resend) {
        final session = await recovery.send(_email.text.trim());
        if (!mounted) return;
        setState(() {
          _session = session;
          _verified = false;
          _otp.clear();
          _password.clear();
          _confirmation.clear();
          _resendAfter = DateTime.now().add(const Duration(seconds: 30));
        });
      } else if (!_verified) {
        final session = await recovery.verify(
          _session!.token,
          _otp.text.trim(),
        );
        if (!mounted) return;
        setState(() {
          _session = session;
          _verified = true;
        });
      } else {
        await recovery.reset(
          _session!.token,
          _password.text,
          _confirmation.text,
        );
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Password reset successfully. Log in with your new password.',
            ),
          ),
        );
        context.go('/login');
      }
    } catch (error) {
      if (!mounted) return;
      String message =
          'Unable to complete password recovery. Please try again.';
      if (error is DioException) {
        final data = error.response?.data;
        if (data is Map &&
            data['error'] is Map &&
            data['error']['message'] is String) {
          message = data['error']['message'] as String;
        } else {
          message =
              'Unable to reach the authentication service. Please try again.';
        }
      }
      setState(() => _error = message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _session == null
              ? 'Forgot Password'
              : _verified
              ? 'Reset Password'
              : 'Verify recovery code',
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_session == null) ...[
                const Text('Enter your registered email address.'),
                TextFormField(
                  key: const Key('recovery-email'),
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(labelText: 'Email'),
                  validator: (value) {
                    final email = value?.trim() ?? '';
                    if (email.isEmpty) {
                      return 'Email is required';
                    }
                    if (email.length > 320 ||
                        !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                            .hasMatch(email)) {
                      return 'Enter a valid email address';
                    }
                    return null;
                  },
                ),
              ] else ...[
                Text(
                  'If an account exists for ${_email.text.trim()}, a recovery code has been requested.',
                ),
                Text(
                  _expired
                      ? 'Recovery session expired. Request a new code.'
                      : 'Session expires in ${_session!.expiresAt.difference(DateTime.now()).inSeconds} seconds.',
                ),
                if (!_verified)
                  TextFormField(
                    key: const Key('recovery-otp'),
                    controller: _otp,
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(6),
                    ],
                    autofillHints: const [AutofillHints.oneTimeCode],
                    decoration: const InputDecoration(labelText: '6-digit OTP'),
                    validator: (value) =>
                        RegExp(r'^\d{6}$').hasMatch(value ?? '')
                        ? null
                        : 'Enter the 6-digit code',
                  )
                else ...[
                  TextFormField(
                    key: const Key('recovery-password'),
                    controller: _password,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'New password',
                    ),
                    validator: (value) =>
                        value == null || value.length < 8 || value.length > 128
                        ? 'Password must be 8–128 characters'
                        : null,
                  ),
                  TextFormField(
                    key: const Key('recovery-confirmation'),
                    controller: _confirmation,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Confirm password',
                    ),
                    validator: (value) => value != _password.text
                        ? 'Passwords do not match'
                        : null,
                  ),
                ],
              ],
              if (_error != null)
                Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _busy || _expired ? null : () => _submit(),
                child: Text(
                  _busy
                      ? 'Please wait…'
                      : _session == null
                      ? 'Send code'
                      : _verified
                      ? 'Reset password'
                      : 'Verify code',
                ),
              ),
              if (_session != null)
                TextButton(
                  onPressed: _busy || _resendSeconds > 0
                      ? null
                      : () => _submit(resend: true),
                  child: Text(
                    _resendSeconds > 0
                        ? 'Request new code in $_resendSeconds seconds'
                        : 'Request new code',
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
