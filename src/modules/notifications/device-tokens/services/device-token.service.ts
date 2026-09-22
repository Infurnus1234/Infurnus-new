import {
  PostgresDeviceTokenRepository,
  type DeviceTokenRepository,
} from '../repositories/device-token.repository.js';

import type {
  DeviceTokenRecord,
  RegisterDeviceInput,
  UpdateDeviceInput,
} from '../types/device-token.types.js';

interface PostgresError {
  code?: string;
  constraint?: string;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const postgresError = error as PostgresError;

  return postgresError.code === '23505' && postgresError.constraint === constraint;
}

export class DeviceTokenService {
  constructor(
    private readonly repository: DeviceTokenRepository = new PostgresDeviceTokenRepository(),
  ) {}

  async registerDevice(input: RegisterDeviceInput): Promise<DeviceTokenRecord> {
    // --------------------------------------------------------
    // Existing user + device
    // --------------------------------------------------------

    const existingDevice = await this.repository.findByUserAndDeviceId(
      input.userId,
      input.deviceId,
    );

    if (existingDevice) {
      return this.repository.update(existingDevice.id, input.userId, {
        fcmToken: input.fcmToken,
        platform: input.platform,
      });
    }

    // --------------------------------------------------------
    // Token currently belongs to another active device
    // --------------------------------------------------------

    const tokenOwner = await this.repository.findByFcmToken(input.fcmToken);

    if (tokenOwner && tokenOwner.userId !== input.userId) {
      await this.repository.deactivateById(tokenOwner.id);
    }

    // --------------------------------------------------------
    // Create new device
    // --------------------------------------------------------

    try {
      return await this.repository.register(input);
    } catch (error) {
      // Another request may have registered the same
      // user/device concurrently.
      if (isUniqueViolation(error, 'user_devices_unique_device')) {
        const device = await this.repository.findByUserAndDeviceId(input.userId, input.deviceId);

        if (!device) {
          throw error;
        }

        return this.repository.update(device.id, input.userId, {
          fcmToken: input.fcmToken,
          platform: input.platform,
        });
      }

      // Another request may have claimed the same active
      // FCM token concurrently.
      if (isUniqueViolation(error, 'uq_user_devices_fcm_token')) {
        const currentOwner = await this.repository.findByFcmToken(input.fcmToken);

        if (currentOwner && currentOwner.userId === input.userId) {
          return this.repository.update(currentOwner.id, input.userId, {
            platform: input.platform,
            deviceId: input.deviceId,
          });
        }

        throw error;
      }

      throw error;
    }
  }

  async updateDevice(
    id: string,
    userId: string,
    input: UpdateDeviceInput,
  ): Promise<DeviceTokenRecord> {
    const existing = await this.repository.findById(id, userId);

    if (!existing) {
      throw new Error('Device not found');
    }

    // --------------------------------------------------------
    // If token is changing, release the active owner first.
    // --------------------------------------------------------

    if (input.fcmToken) {
      const tokenOwner = await this.repository.findByFcmToken(input.fcmToken);

      if (tokenOwner && tokenOwner.id !== id) {
        await this.repository.deactivateById(tokenOwner.id);
      }
    }

    try {
      return await this.repository.update(id, userId, input);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_user_devices_fcm_token')) {
        const tokenOwner = input.fcmToken
          ? await this.repository.findByFcmToken(input.fcmToken)
          : null;

        if (tokenOwner && tokenOwner.id !== id) {
          await this.repository.deactivateById(tokenOwner.id);

          return this.repository.update(id, userId, input);
        }
      }

      throw error;
    }
  }

  async deactivateDevice(id: string, userId: string): Promise<DeviceTokenRecord> {
    const existing = await this.repository.findById(id, userId);

    if (!existing) {
      throw new Error('Device not found');
    }

    return this.repository.deactivate(id, userId);
  }

  async getActiveDevices(userId: string): Promise<DeviceTokenRecord[]> {
    return this.repository.findActiveByUserId(userId);
  }

  async deactivateInvalidToken(fcmToken: string): Promise<void> {
    await this.repository.deactivateByFcmToken(fcmToken);
  }
}
