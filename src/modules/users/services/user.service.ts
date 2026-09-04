import { AppError } from '../../../common/errors/app-error.js';
import type {
  CreateAddressInput,
  CreateUserInput,
  UpdateAddressInput,
  UpdatePreferencesInput,
  UpdateUserInput,
} from '../schemas/user.schemas.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { UpdateUserData } from '../types/user.js';

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
      const updateData: UpdateUserData = {};
      if (data.firstName !== undefined) updateData.firstName = data.firstName;
      if (data.lastName !== undefined) updateData.lastName = data.lastName;
      if (data.email !== undefined) updateData.email = data.email;
      if (data.phone !== undefined) updateData.phone = data.phone;

      const user = await this.repository.update(id, updateData);
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

  async createAddress(userId: string, data: CreateAddressInput) {
    await this.getUser(userId);
    try {
      return await this.repository.createAddress(userId, data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('DEFAULT_ADDRESS_CONFLICT', 'User already has a default address', 409);
      }
      throw error;
    }
  }

  async updateAddress(userId: string, addressId: string, data: UpdateAddressInput) {
    await this.getUser(userId);
    try {
      const address = await this.repository.updateAddress(userId, addressId, data);
      if (!address) throw new AppError('ADDRESS_NOT_FOUND', 'Address not found', 404);
      return address;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('DEFAULT_ADDRESS_CONFLICT', 'User already has a default address', 409);
      }
      throw error;
    }
  }

  async getAddresses(userId: string) {
    await this.getUser(userId);
    return this.repository.findAddresses(userId);
  }

  async getPreferences(userId: string) {
    await this.getUser(userId);
    return (
      (await this.repository.findPreferences(userId)) ?? {
        userId,
        pushNotificationsEnabled: true,
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: true,
      }
    );
  }

  async updatePreferences(userId: string, data: UpdatePreferencesInput) {
    await this.getUser(userId);
    return this.repository.updatePreferences(userId, data);
  }

  async getHistory(userId: string, limit: number) {
    await this.getUser(userId);
    return this.repository.findHistory(userId, limit);
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
