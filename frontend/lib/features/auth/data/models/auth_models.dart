import '../../domain/entities/user.dart';

class SignupRequest {
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final String password;
  final String confirmPassword;
  final String role;

  SignupRequest({
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
    required this.password,
    required this.confirmPassword,
    required this.role,
  });

  Map<String, dynamic> toJson() => {
        'firstName': firstName,
        'lastName': lastName,
        if (email != null) 'email': email,
        if (phone != null) 'phone': phone,
        'password': password,
        'confirmPassword': confirmPassword,
        'role': role,
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

  VerifySignupRequest({
    required this.signupId,
    required this.otp,
  });

  Map<String, dynamic> toJson() => {
        'signupId': signupId,
        'otp': otp,
      };
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
      userId: json['userId'] as String,
      accessToken: json['accessToken'] as String,
      expiresAt: json['expiresAt'] as String,
    );
  }
}

class ResendSignupRequest {
  final String signupId;

  ResendSignupRequest({
    required this.signupId,
  });

  Map<String, dynamic> toJson() => {
        'signupId': signupId,
      };
}

class LoginRequest {
  final String? email;
  final String? phone;
  final String password;

  LoginRequest({
    this.email,
    this.phone,
    required this.password,
  });

  Map<String, dynamic> toJson() => {
        if (email != null) 'email': email,
        if (phone != null) 'phone': phone,
        'password': password,
      };
}

class LoginChallengeResponse {
  final String challengeId;
  final String expiresAt;

  LoginChallengeResponse({
    required this.challengeId,
    required this.expiresAt,
  });

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

  VerifyLoginRequest({
    required this.challengeId,
    required this.otp,
  });

  Map<String, dynamic> toJson() => {
        'challengeId': challengeId,
        'otp': otp,
      };
}

class ResendLoginRequest {
  final String challengeId;

  ResendLoginRequest({
    required this.challengeId,
  });

  Map<String, dynamic> toJson() => {
        'challengeId': challengeId,
      };
}

class PublicUser {
  final String id;
  final String firstName;
  final String lastName;
  final String email;
  final String phone;
  final DateTime createdAt;
  final DateTime updatedAt;

  PublicUser({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.phone,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PublicUser.fromJson(Map<String, dynamic> json) {
    return PublicUser(
      id: json['id'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      email: json['email'] as String,
      phone: json['phone'] as String,
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
