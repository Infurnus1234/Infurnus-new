import { AppError } from '../../../common/errors/app-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

import type { UserCredentialsRepository } from '../repositories/user-credentials.repository.js';

export class ChangePasswordService {
  constructor(
    private readonly userCredentialsRepository: UserCredentialsRepository,
  ) {}

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const passwordHash =
      await this.userCredentialsRepository.findPasswordHashByUserId(
        userId,
      );

    if (!passwordHash) {
      throw new AppError(
        'PASSWORD_CREDENTIALS_NOT_FOUND',
        'Password credentials not found',
        404,
      );
    }

    const validCurrentPassword = await verifyPassword(
      passwordHash,
      currentPassword,
    );

    if (!validCurrentPassword) {
      throw new AppError(
        'CURRENT_PASSWORD_INVALID',
        'Current password is incorrect',
        400,
      );
    }

    const samePassword = await verifyPassword(
      passwordHash,
      newPassword,
    );

    if (samePassword) {
      throw new AppError(
        'NEW_PASSWORD_SAME_AS_CURRENT',
        'New password must be different from the current password',
        400,
      );
    }

    const newPasswordHash = await hashPassword(newPassword);

    const updated =
      await this.userCredentialsRepository.updatePassword(
        userId,
        newPasswordHash,
      );

    if (!updated) {
      throw new AppError(
        'PASSWORD_UPDATE_FAILED',
        'Unable to update password',
        500,
      );
    }
  }
}