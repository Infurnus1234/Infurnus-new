import { AppError } from '../../../common/errors/app-error.js';
import type { CreateUserInput, UpdateUserInput } from '../schemas/user.schemas.js';
import type { UserRepository } from '../repositories/user.repository.js';

export class UserService {
  constructor(private readonly repository: UserRepository) {}

  async createUser(data: CreateUserInput) {
    try {
      return await this.repository.create(data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('USER_ALREADY_EXISTS', 'A user with this email already exists', 409);
      }
      throw error;
    }
  }

  async getUser(id: string) {
    const user = await this.repository.findById(id);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }
    return user;
  }

  async updateUser(id: string, data: UpdateUserInput) {
    try {
      const user = await this.repository.update(id, data);
      if (!user) {
        throw new AppError('USER_NOT_FOUND', 'User not found', 404);
      }
      return user;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('USER_ALREADY_EXISTS', 'A user with this email already exists', 409);
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
