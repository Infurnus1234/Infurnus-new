import { AppError } from '../../../common/errors/app-error.js';
import type { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import { hashRefreshToken } from '../utils/refresh-token.js';

export class LogoutService {
  constructor(private readonly repository: RefreshTokenRepository) {}

  async logout(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', 401);
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);

    const token = await this.repository.findActiveByHash(tokenHash);

    if (!token) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401);
    }

    const revoked = await this.repository.revoke(token.id);

    if (!revoked) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401);
    }
  }

  async logoutFamily(familyId: string): Promise<void> {
    if (!familyId) {
      throw new AppError('INVALID_TOKEN_FAMILY', 'Invalid token family', 400);
    }

    await this.repository.revokeFamily(familyId);
  }

  async logoutAllForUser(userId: string): Promise<void> {
    if (!userId) {
      throw new AppError('INVALID_USER', 'Invalid user', 400);
    }

    await this.repository.revokeAllForUser(userId);
  }
}
