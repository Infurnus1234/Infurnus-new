import { pool } from '../../../../infrastructure/database/postgres.js';

import type {
  DevicePlatform,
  DeviceTokenRecord,
  RegisterDeviceInput,
  UpdateDeviceInput,
} from '../types/device-token.types.js';

interface DeviceTokenRow {
  id: string;
  user_id: string;
  fcm_token: string;
  platform: DevicePlatform;
  device_id: string;
  is_active: boolean;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

function mapDeviceRow(row: DeviceTokenRow): DeviceTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    fcmToken: row.fcm_token,
    platform: row.platform,
    deviceId: row.device_id,
    isActive: row.is_active,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface DeviceTokenRepository {
  findById(id: string, userId: string): Promise<DeviceTokenRecord | null>;

  findByUserAndDeviceId(userId: string, deviceId: string): Promise<DeviceTokenRecord | null>;

  findByFcmToken(fcmToken: string): Promise<DeviceTokenRecord | null>;

  findActiveByUserId(userId: string): Promise<DeviceTokenRecord[]>;

  register(input: RegisterDeviceInput): Promise<DeviceTokenRecord>;

  update(id: string, userId: string, input: UpdateDeviceInput): Promise<DeviceTokenRecord>;

  deactivate(id: string, userId: string): Promise<DeviceTokenRecord>;

  deactivateByFcmToken(fcmToken: string): Promise<DeviceTokenRecord | null>;

  deactivateById(id: string): Promise<DeviceTokenRecord | null>;
}

export class PostgresDeviceTokenRepository implements DeviceTokenRepository {
  async findById(id: string, userId: string): Promise<DeviceTokenRecord | null> {
    const result = await pool.query<DeviceTokenRow>(
      `
        SELECT
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
        FROM user_devices
        WHERE id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [id, userId],
    );

    const row = result.rows[0];

    return row ? mapDeviceRow(row) : null;
  }

  async findByUserAndDeviceId(userId: string, deviceId: string): Promise<DeviceTokenRecord | null> {
    const result = await pool.query<DeviceTokenRow>(
      `
        SELECT
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
        FROM user_devices
        WHERE user_id = $1
          AND device_id = $2
        LIMIT 1
      `,
      [userId, deviceId],
    );

    const row = result.rows[0];

    return row ? mapDeviceRow(row) : null;
  }

  async findByFcmToken(fcmToken: string): Promise<DeviceTokenRecord | null> {
    const result = await pool.query<DeviceTokenRow>(
      `
        SELECT
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
        FROM user_devices
        WHERE fcm_token = $1
          AND is_active = TRUE
        ORDER BY last_seen_at DESC
        LIMIT 1
      `,
      [fcmToken],
    );

    const row = result.rows[0];

    return row ? mapDeviceRow(row) : null;
  }

  async findActiveByUserId(userId: string): Promise<DeviceTokenRecord[]> {
    const result = await pool.query<DeviceTokenRow>(
      `
        SELECT
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
        FROM user_devices
        WHERE user_id = $1
          AND is_active = TRUE
        ORDER BY last_seen_at DESC
      `,
      [userId],
    );

    return result.rows.map(mapDeviceRow);
  }

  async register(input: RegisterDeviceInput): Promise<DeviceTokenRecord> {
    const result = await pool.query<DeviceTokenRow>(
      `
        INSERT INTO user_devices (
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          TRUE,
          NOW()
        )
        RETURNING
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
      `,
      [input.userId, input.fcmToken, input.platform, input.deviceId],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error('Device record was not created');
    }

    return mapDeviceRow(row);
  }

  async update(id: string, userId: string, input: UpdateDeviceInput): Promise<DeviceTokenRecord> {
    const result = await pool.query<DeviceTokenRow>(
      `
        UPDATE user_devices
        SET
          fcm_token = COALESCE($3, fcm_token),
          platform = COALESCE($4, platform),
          device_id = COALESCE($5, device_id),
          is_active = TRUE,
          last_seen_at = NOW()
        WHERE id = $1
          AND user_id = $2
        RETURNING
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
      `,
      [id, userId, input.fcmToken ?? null, input.platform ?? null, input.deviceId ?? null],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error('Device record was not found');
    }

    return mapDeviceRow(row);
  }

  async deactivate(id: string, userId: string): Promise<DeviceTokenRecord> {
    const result = await pool.query<DeviceTokenRow>(
      `
        UPDATE user_devices
        SET
          is_active = FALSE,
          last_seen_at = NOW()
        WHERE id = $1
          AND user_id = $2
        RETURNING
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
      `,
      [id, userId],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error('Device record was not found');
    }

    return mapDeviceRow(row);
  }

  async deactivateByFcmToken(fcmToken: string): Promise<DeviceTokenRecord | null> {
    const result = await pool.query<DeviceTokenRow>(
      `
        UPDATE user_devices
        SET
          is_active = FALSE,
          last_seen_at = NOW()
        WHERE fcm_token = $1
          AND is_active = TRUE
        RETURNING
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
      `,
      [fcmToken],
    );

    const row = result.rows[0];

    return row ? mapDeviceRow(row) : null;
  }

  async deactivateById(id: string): Promise<DeviceTokenRecord | null> {
    const result = await pool.query<DeviceTokenRow>(
      `
        UPDATE user_devices
        SET
          is_active = FALSE,
          last_seen_at = NOW()
        WHERE id = $1
          AND is_active = TRUE
        RETURNING
          id,
          user_id,
          fcm_token,
          platform,
          device_id,
          is_active,
          last_seen_at,
          created_at,
          updated_at
      `,
      [id],
    );

    const row = result.rows[0];

    return row ? mapDeviceRow(row) : null;
  }
}
