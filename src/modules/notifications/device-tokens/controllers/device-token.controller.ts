import type { NextFunction, Request, Response } from 'express';

import {
  deviceIdParamSchema,
  registerDeviceSchema,
  updateDeviceSchema,
} from '../schemas/device-token.schema.js';

import { DeviceTokenService } from '../services/device-token.service.js';

export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = registerDeviceSchema.parse(req.body);

      const device = await this.deviceTokenService.registerDevice({
        userId: req.auth!.userId,
        fcmToken: input.fcmToken,
        platform: input.platform,
        deviceId: input.deviceId,
      });

      res.status(200).json({
        success: true,
        data: device,
        message: 'Device registered successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const devices = await this.deviceTokenService.getActiveDevices(req.auth!.userId);

      res.json({
        success: true,
        data: devices,
        message: 'Active devices retrieved successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { deviceId } = deviceIdParamSchema.parse(req.params);

      const input = updateDeviceSchema.parse(req.body);

      const updateInput = {
        ...(input.fcmToken !== undefined ? { fcmToken: input.fcmToken } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
        ...(input.deviceId !== undefined ? { deviceId: input.deviceId } : {}),
      };

      const device = await this.deviceTokenService.updateDevice(
        deviceId,
        req.auth!.userId,
        updateInput,
      );

      res.json({
        success: true,
        data: device,
        message: 'Device updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  deactivate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { deviceId } = deviceIdParamSchema.parse(req.params);

      const device = await this.deviceTokenService.deactivateDevice(deviceId, req.auth!.userId);

      res.json({
        success: true,
        data: device,
        message: 'Device deactivated successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
