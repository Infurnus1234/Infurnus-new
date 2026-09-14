import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../shared/widgets/infurnus_button.dart';
import '../../../../shared/widgets/infurnus_phone_field.dart';
import '../../../../shared/widgets/infurnus_text_field.dart';
import '../../data/models/auth_models.dart';
import '../providers/auth_provider.dart';

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    // Listen for status changes to navigate to OTP
    ref.listen(authProvider, (previous, next) {
      if (next.status == AuthStatus.otpRequired) {
        context.push('/otp');
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Create Account'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Join INFURNUS',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 24),
              InfurnusTextField(
                label: 'First Name',
                hintText: 'John',
                controller: _firstNameController,
              ),
              const SizedBox(height: 16),
              InfurnusTextField(
                label: 'Last Name',
                hintText: 'Doe',
                controller: _lastNameController,
              ),
              const SizedBox(height: 16),
              InfurnusPhoneField(
                controller: _phoneController,
              ),
              const SizedBox(height: 16),
              InfurnusTextField(
                label: 'Password',
                hintText: '********',
                controller: _passwordController,
                isPassword: true,
              ),
              const SizedBox(height: 16),
              InfurnusTextField(
                label: 'Confirm Password',
                hintText: '********',
                controller: _confirmPasswordController,
                isPassword: true,
              ),
              const SizedBox(height: 32),
              if (authState.errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    authState.errorMessage!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              InfurnusButton(
                text: 'Sign Up',
                isLoading: authState.status == AuthStatus.loading,
                onPressed: () {
                  final request = SignupRequest(
                    firstName: _firstNameController.text,
                    lastName: _lastNameController.text,
                    phone: _phoneController.text,
                    password: _passwordController.text,
                    confirmPassword: _confirmPasswordController.text,
                    role: 'customer',
                  );
                  ref.read(authProvider.notifier).signup(request);
                },
              ),
              const SizedBox(height: 16),
              Center(
                child: TextButton(
                  onPressed: () => context.pop(),
                  child: const Text('Already have an account? Login'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
