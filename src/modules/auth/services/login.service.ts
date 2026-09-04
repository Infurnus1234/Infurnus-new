import { AppError } from '../../../common/errors/app-error.js';
import type { LoginRepository } from '../repositories/login.repository.js';
import { verifyPassword } from '../utils/password.js';
import { normalizeEmail, normalizePhone } from '../utils/contact.js';

import type { LoginInput } from '../types/login.js';

export class LoginService {
  constructor(private readonly repository: LoginRepository) {}

  async authenticate(input: LoginInput) {
    const hasEmail = Boolean(input.email);
    const hasPhone = Boolean(input.phone);

    if (hasEmail === hasPhone) {
      throw new AppError('INVALID_LOGIN', 'Provide either email or phone number', 400);
    }

    const identity = hasEmail
      ? await this.repository.findByEmail(normalizeEmail(input.email!))
      : await this.repository.findByPhone(normalizePhone(input.phone!));

    if (!identity) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email/phone or password', 401);
    }

    if (identity.status !== 'active') {
      throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
    }

    const validPassword = await verifyPassword(identity.passwordHash, input.password);

    if (!validPassword) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email/phone or password', 401);
    }

    return {
      userId: identity.id,
      role: identity.role,
    };
  }
}
