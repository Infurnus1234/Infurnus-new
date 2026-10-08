import 'dart:convert';

import '../../domain/entities/user.dart';

class SignupRequest {
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final String password;
  final String confirmPassword;
  final String role;
  final String? licenseNumber;
  final String? licenseExpiry;

  SignupRequest({
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
    required this.password,
    required this.confirmPassword,
    required this.role,
    this.licenseNumber,
    this.licenseExpiry,
  });

  Map<String, dynamic> toJson() => {
    'firstName': firstName,
    'lastName': lastName,
    if (email != null) 'email': email,
    if (phone != null) 'phone': phone,
    'password': password,
    'confirmPassword': confirmPassword,
    'role': role,
    if (licenseNumber != null) 'licenseNumber': licenseNumber,
    if (licenseExpiry != null) 'licenseExpiry': licenseExpiry,
  };
}

class SignupResponse {
  final String signupId;
  final String contactType;
  final String expiresAt;

  SignupResponse({
    required this.signupId,
    required this.contactType,
    required this.expiresAt,
  });

  factory SignupResponse.fromJson(Map<String, dynamic> json) {
    return SignupResponse(
      signupId: json['signupId'] as String,
      contactType: json['contactType'] as String,
      expiresAt: json['expiresAt'] as String,
    );
  }
}

class VerifySignupRequest {
  final String signupId;
  final String otp;

  VerifySignupRequest({required this.signupId, required this.otp});

  Map<String, dynamic> toJson() => {'signupId': signupId, 'otp': otp};
}

class AuthResponse {
  final String userId;
  final String accessToken;
  final String expiresAt;

  AuthResponse({
    required this.userId,
    required this.accessToken,
    required this.expiresAt,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    return AuthResponse(
      userId:
          json['userId'] as String? ??
          _accessTokenPayload(json['accessToken'] as String)['sub'] as String,
      accessToken: json['accessToken'] as String,
      expiresAt: json['expiresAt'] as String,
    );
  }
}

class ResendSignupRequest {
  final String signupId;

  ResendSignupRequest({required this.signupId});

  Map<String, dynamic> toJson() => {'signupId': signupId};
}

class LoginRequest {
  final String? email;
  final String? phone;
  final String password;

  LoginRequest({this.email, this.phone, required this.password});

  Map<String, dynamic> toJson() => {
    if (email != null) 'email': email,
    if (phone != null) 'phone': phone,
    'password': password,
  };
}

class LoginChallengeResponse {
  final String challengeId;
  final String expiresAt;

  LoginChallengeResponse({required this.challengeId, required this.expiresAt});

  factory LoginChallengeResponse.fromJson(Map<String, dynamic> json) {
    return LoginChallengeResponse(
      challengeId: json['challengeId'] as String,
      expiresAt: json['expiresAt'] as String,
    );
  }
}

class VerifyLoginRequest {
  final String challengeId;
  final String otp;

  VerifyLoginRequest({required this.challengeId, required this.otp});

  Map<String, dynamic> toJson() => {'challengeId': challengeId, 'otp': otp};
}

class ResendLoginRequest {
  final String challengeId;

  ResendLoginRequest({required this.challengeId});

  Map<String, dynamic> toJson() => {'challengeId': challengeId};
}

class PublicUser {
  final String id;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final DateTime createdAt;
  final DateTime updatedAt;

  PublicUser({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PublicUser.fromJson(Map<String, dynamic> json) {
    return PublicUser(
      id: json['id'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  User toEntity(String userRole) {
    return User(
      id: id,
      firstName: firstName,
      lastName: lastName,
      email: email,
      phone: phone,
      role: userRole,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }
}

class PasswordRecoverySession {
  final String token;
  final DateTime expiresAt;
  PasswordRecoverySession({required this.token, required this.expiresAt});
  factory PasswordRecoverySession.fromJson(Map<String, dynamic> json) =>
      PasswordRecoverySession(
        token: json['resetSessionToken'] as String,
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );
}

// Used only for navigation; the backend validates the signed token on requests.
String authRoleFromToken(String token) {
  final payload = _accessTokenPayload(token);
  final role = payload['role'];
  if (![
    'customer',
    'driver',
    'fleet_owner',
    'driver_fleet_owner',
    'admin',
    'super_admin',
  ].contains(role)) {
    throw const FormatException('Unsupported account role');
  }
  return role as String;
}

Map<String, dynamic> _accessTokenPayload(String token) {
  final parts = token.split('.');
  if (parts.length != 3) {
    throw const FormatException('Invalid access token');
  }
  final payload = jsonDecode(
    utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
  ) as Map<String, dynamic>;
  return payload;
}

// This frontend runs in customer-only mode; token roles remain unchanged.
String authHomeRoute(String? role) => '/customer-home';
