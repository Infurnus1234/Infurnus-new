import { AppError } from '../../../common/errors/app-error.js';
import type { AuthUserRepository } from '../repositories/auth-user.repository.js';

export class AuthUserService {
  constructor(private readonly repository: AuthUserRepository) {}

  async getIdentity(userId: string) {
    const identity = await this.repository.findIdentityById(userId);

    if (!identity) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', 401);
    }

    if (identity.status !== 'active') {
      throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
    }

    return identity;
  }
}
