# DAY 7 — Backend Email, OTP & Authentication Flow Testing

## Date
22 September 2026

## Tester
Manshi

## Scope
Backend-only QA testing. No frontend UI or frontend integration testing was performed.

## Environment
- Backend/API: Infurnus Backend
- API Base URL: `http://localhost:3000`
- API Testing Tool: cURL
- Environment: Local QA environment
- Focus: Email, OTP, Authentication, Account Recovery and Account Lifecycle

## 1. Test Coverage

- Total backend test cases executed/documented: **84+**
- Minimum required: **40–50**
- Minimum requirement: **Satisfied**
- Positive scenarios: **Covered**
- Negative scenarios: **Covered**
- Edge/security scenarios: **Covered**

### Modules Covered
- Signup & Registration
- Email/OTP Verification
- Login & OTP Authentication
- OTP Resend/Rate Limiting
- Forgot Password
- Password Reset
- Change Password
- Account Deletion
- Authentication/Session Security
- Email Provider Failure Handling
- Validation & Error Handling

## 2. Real Email Delivery Testing

Minimum required: **5 real authorized email addresses**

### Emails Tested
1. `manshiarya0810@gmail.com`
2. `manshicbse2004@gmail.com`
3. `nishiraj8695@gmail.com`
4. `purnimabharti420@gmail.com`
5. `manshi.2023becse087@student.nimsuniversity.org`

### Verification Performed
- Backend email/OTP API triggered
- Backend response verified
- Actual inbox checked
- OTP received
- OTP used for verification where applicable

**Status: PASS — minimum 5 real email addresses tested.**

## 3. Signup & Registration Testing

Tested/verified:
- Valid signup
- Invalid email
- Missing required fields
- Duplicate email
- Invalid/weak password
- OTP generation
- OTP email delivery
- Correct OTP verification
- Incorrect OTP
- Expired OTP
- OTP reuse
- OTP resend
- Multiple OTP requests
- OTP rate limiting
- Account creation after successful verification

**Status: PASS**

## 4. Login Testing

Tested/verified:
- Valid credentials
- Incorrect password
- Non-existing/invalid account scenarios
- Invalid email validation
- OTP-based login
- Login challenge generation
- OTP verification
- Access token generation
- Invalid access token
- Expired/invalid authentication token
- Refresh token flow
- Logout/session handling
- Logout-all/session invalidation
- Login rate limiting

**Status: PASS**

## 5. OTP Testing

Tested/verified:
- OTP generation
- OTP email triggering
- Actual OTP delivery
- Correct OTP
- Incorrect OTP
- Expired OTP
- OTP reuse
- OTP resend
- New OTP generation
- Previous/stale OTP behavior
- OTP format/length
- OTP expiry
- Maximum verification attempts
- OTP request rate limiting
- OTP resend cooldown
- OTP across different email addresses
- OTP provider/session failure handling

Observed controlled provider/error responses:
- `OTP_PROVIDER_SESSION_INVALID`
- `OTP_PROVIDER_RESEND_FAILED`
- `OTP_RESEND_TOO_SOON`

**Status: PASS with documented provider/error scenarios**

## 6. Forgot Password Testing

Initially the endpoint was missing and returned `404`.

Implemented and tested:

`POST /auth/forgot-password`

Verified:
- Registered email
- Reset challenge generation
- Reset OTP/email triggering
- OTP verification
- Password recovery flow
- Invalid OTP handling
- Password reset flow

**Status: PASS after implementation**

## 7. Password Reset Testing

Implemented and tested:

`POST /auth/reset-password`

Verified:
- Reset challenge
- Valid OTP
- Invalid OTP
- New password validation
- Password update
- Password hashing
- Reset challenge consumption
- Login with new password
- Old password rejection

**Status: PASS**

## 8. Change Password Testing

Implemented and tested:

`POST /auth/change-password`

Verified:
- Valid current password
- Incorrect current password
- Invalid/weak new password validation
- Successful password change
- Login using new password
- Old password behavior

Observed:
- Incorrect current password → `400 CURRENT_PASSWORD_INVALID`
- Successful password change → `200`

### Remaining dedicated edge case
- Same old/new password needs one final test using a password that passes the password-strength schema.

**Status: PASS for implemented flow; one edge case pending final execution**

## 9. Account Deletion Testing

Implemented and tested:

`DELETE /auth/account`

Security requirements verified:
- Authentication required
- Invalid/expired token rejected
- CSRF protection required
- CSRF cookie + `X-CSRF-Token` header validated

Successful deletion response:

`204 No Content`

Also verified:
- Refresh token cookie cleared
- CSRF cookie cleared
- Account could no longer authenticate after deletion

Post-deletion login attempt returned:

`401 Unauthorized`  
`INVALID_CREDENTIALS`

**Status: PASS**

## 10. Negative & Failure Testing

Tested:
- Invalid request payload
- Missing fields
- Invalid OTP
- Expired OTP
- OTP reuse
- Invalid access token
- Expired/invalid authentication token
- OTP provider session failure
- OTP resend/provider failure
- OTP resend cooldown
- OTP rate limiting
- Login rate limiting
- CSRF token missing
- CSRF token validation
- Malformed JSON requests

### Known Bug

**BUG-D7-001 — Malformed JSON returns HTTP 500**

Several malformed JSON requests on authentication/OTP endpoints returned:

`500 Internal Server Error`

Expected behavior:

`400 Bad Request`

This should be fixed so malformed client input is handled as a controlled request/validation error instead of an internal server error.

**Status: BUG FOUND**

## 11. Backend/API Security Verification

Verified:
- Authentication middleware
- Access-token validation
- Refresh-token flow
- Session invalidation
- CSRF protection
- Rate limiting
- OTP cooldown
- OTP verification limits
- Password hashing/update flow
- Account soft deletion
- Cookie clearing after deletion

## 12. Authentication Lifecycle

The following lifecycle was validated:

**Signup → Email/OTP → Verification → Login → OTP/Authentication → Forgot Password → Password Reset → Change Password → Account Deletion**

Final account deletion verification:
- Account deletion → `204 No Content`
- Refresh/CSRF cookies cleared
- Login after deletion → `401 INVALID_CREDENTIALS`

**Status: PASS**

## 13. Remaining Checks Before Final Submission

1. Same old/new password using a valid password.
2. OTP/recovery behavior after account deletion.
3. Re-registration using the deleted email.
4. If required, separately document email sender, subject, formatting and sensitive-information checks.

## 14. Day 7 Overall Status

### Completed
- [x] Minimum 40–50 backend test cases
- [x] 50+ preferred coverage
- [x] Minimum 5 real email addresses
- [x] Actual inbox OTP verification
- [x] Signup testing
- [x] Email verification testing
- [x] Login testing
- [x] OTP testing
- [x] Forgot Password
- [x] Password Reset
- [x] Change Password implementation/testing
- [x] Account Deletion implementation/testing
- [x] Rate limiting
- [x] Security/CSRF testing
- [x] Failure/error testing
- [x] Bug documentation

### Pending
- [ ] Same old/new password dedicated test
- [ ] OTP behavior after account deletion
- [ ] Re-registration after account deletion
- [ ] Final detailed test-case report reconciliation

## Conclusion

Day 7 backend Email, OTP and Authentication testing was substantially completed. The major authentication lifecycle and the previously missing Forgot Password, Password Reset, Change Password and Account Deletion flows were implemented/tested at API level. One confirmed issue, **BUG-D7-001**, was identified for malformed JSON handling.
