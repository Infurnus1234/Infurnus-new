export { NotificationService } from './services/notification.service.js';

export { NOTIFICATION_TYPES } from './types/notification.types.js';

export type { NotificationType, NotificationPayload } from './types/notification.types.js';

export { DeviceTokenController } from './device-tokens/controllers/device-token.controller.js';

export { PostgresDeviceTokenRepository } from './device-tokens/repositories/device-token.repository.js';

export { createDeviceTokenRouter } from './device-tokens/routes/device-token.routes.js';

export { DeviceTokenService } from './device-tokens/services/device-token.service.js';

export {
  deviceIdParamSchema,
  devicePlatformSchema,
  registerDeviceSchema,
  updateDeviceSchema,
} from './device-tokens/schemas/device-token.schema.js';

export { DEVICE_PLATFORMS } from './device-tokens/types/device-token.types.js';

export type {
  DevicePlatform,
  DeviceTokenRecord,
  RegisterDeviceInput,
  UpdateDeviceInput,
} from './device-tokens/types/device-token.types.js';
