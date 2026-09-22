export const DEVICE_PLATFORMS = {
  ANDROID: 'ANDROID',
  IOS: 'IOS',
  WEB: 'WEB',
} as const;

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[keyof typeof DEVICE_PLATFORMS];

export interface RegisterDeviceInput {
  userId: string;
  fcmToken: string;
  platform: DevicePlatform;
  deviceId: string;
}

export interface UpdateDeviceInput {
  fcmToken?: string;
  platform?: DevicePlatform;
  deviceId?: string;
}

export interface DeviceTokenRecord {
  id: string;
  userId: string;
  fcmToken: string;
  platform: DevicePlatform;
  deviceId: string;
  isActive: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
