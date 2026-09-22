export { DeviceTokenController } from './controllers/device-token.controller.js';

export { PostgresDeviceTokenRepository } from './repositories/device-token.repository.js';

export { createDeviceTokenRouter } from './routes/device-token.routes.js';

export { DeviceTokenService } from './services/device-token.service.js';

export {
  deviceIdParamSchema,
  devicePlatformSchema,
  registerDeviceSchema,
  updateDeviceSchema,
} from './schemas/device-token.schema.js';

export { DEVICE_PLATFORMS } from './types/device-token.types.js';

export type {
  DevicePlatform,
  DeviceTokenRecord,
  RegisterDeviceInput,
  UpdateDeviceInput,
} from './types/device-token.types.js';
