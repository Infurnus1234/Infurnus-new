import { z } from 'zod';

export const devicePlatformSchema = z.enum(['ANDROID', 'IOS', 'WEB']);

export const registerDeviceSchema = z.object({
  fcmToken: z.string().trim().min(1, 'FCM token is required').max(4096, 'FCM token is too long'),

  platform: devicePlatformSchema,

  deviceId: z.string().trim().min(1, 'Device ID is required').max(255, 'Device ID is too long'),
});

export const updateDeviceSchema = z
  .object({
    fcmToken: z
      .string()
      .trim()
      .min(1, 'FCM token cannot be empty')
      .max(4096, 'FCM token is too long')
      .optional(),

    platform: devicePlatformSchema.optional(),

    deviceId: z
      .string()
      .trim()
      .min(1, 'Device ID cannot be empty')
      .max(255, 'Device ID is too long')
      .optional(),
  })
  .refine(
    (value) =>
      value.fcmToken !== undefined || value.platform !== undefined || value.deviceId !== undefined,
    {
      message: 'At least one field is required',
    },
  );

export const deviceIdParamSchema = z.object({
  deviceId: z.string().uuid('Invalid device ID'),
});
