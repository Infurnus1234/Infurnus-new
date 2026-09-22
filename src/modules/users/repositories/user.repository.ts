import type { Pool } from 'pg';
import type {
  CreateAddressData,
  CreateUserData,
  PublicUser,
  UpdateAddressData,
  UpdateUserPreferencesData,
  UserAddress,
  UserHistoryEntry,
  UserPreferences,
  UpdateUserData,
} from '../types/user.js';

export interface UserRepository {
  create(data: CreateUserData): Promise<PublicUser>;
  findById(id: string): Promise<PublicUser | null>;
  update(id: string, data: UpdateUserData): Promise<PublicUser | null>;
  softDelete(id: string): Promise<boolean>;
  createAddress(userId: string, data: CreateAddressData): Promise<UserAddress>;
  updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressData,
  ): Promise<UserAddress | null>;
  findAddresses(userId: string): Promise<UserAddress[]>;
  findPreferences(userId: string): Promise<UserPreferences | null>;
  updatePreferences(
    userId: string,
    data: UpdateUserPreferencesData,
  ): Promise<UserPreferences | null>;
  findHistory(userId: string, limit: number): Promise<UserHistoryEntry[]>;
}

const USER_COLUMNS = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
} as const;

const ADDRESS_COLUMNS = {
  label: 'label',
  addressLine1: 'address_line_1',
  addressLine2: 'address_line_2',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  isDefault: 'is_default',
} as const;

const PREFERENCE_COLUMNS = {
  pushNotificationsEnabled: 'push_notifications_enabled',
  emailNotificationsEnabled: 'email_notifications_enabled',
  smsNotificationsEnabled: 'sms_notifications_enabled',
} as const;

const PUBLIC_USER_PROJECTION = `
  id,
  first_name AS "firstName",
  last_name AS "lastName",
  email,
  phone,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const ADDRESS_PROJECTION = `
  id,
  user_id AS "userId",
  label,
  address_line_1 AS "addressLine1",
  address_line_2 AS "addressLine2",
  city,
  state,
  postal_code AS "postalCode",
  country,
  latitude,
  longitude,
  is_default AS "isDefault",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const PREFERENCES_PROJECTION = `
  user_id AS "userId",
  push_notifications_enabled AS "pushNotificationsEnabled",
  email_notifications_enabled AS "emailNotificationsEnabled",
  sms_notifications_enabled AS "smsNotificationsEnabled",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreateUserData): Promise<PublicUser> {
    const result = await this.pool.query<PublicUser>(
      `INSERT INTO users (first_name, last_name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING ${PUBLIC_USER_PROJECTION}`,
      [data.firstName, data.lastName, data.email, data.phone],
    );

    const user = result.rows[0];

    if (!user) {
      throw new Error('User insert returned no row');
    }

    return user;
  }

  async findById(id: string): Promise<PublicUser | null> {
    const result = await this.pool.query<PublicUser>(
      `SELECT ${PUBLIC_USER_PROJECTION}
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL
       LIMIT 1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async update(id: string, data: UpdateUserData): Promise<PublicUser | null> {
    const fields = Object.keys(data) as Array<keyof UpdateUserData>;

    if (fields.length === 0) {
      return this.findById(id);
    }

    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const field of fields) {
      const column = USER_COLUMNS[field];

      if (!column) {
        continue;
      }

      values.push(data[field]);
      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const result = await this.pool.query<PublicUser>(
      `UPDATE users
       SET ${assignments.join(', ')},
           updated_at = NOW()
       WHERE id = $${values.length}
         AND deleted_at IS NULL
       RETURNING ${PUBLIC_USER_PROJECTION}`,
      values,
    );

    return result.rows[0] ?? null;
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE users
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL`,
      [id],
    );

    return result.rowCount === 1;
  }

  async createAddress(userId: string, data: CreateAddressData): Promise<UserAddress> {
    const result = await this.pool.query<UserAddress>(
      `INSERT INTO user_addresses
       (
         user_id,
         label,
         address_line_1,
         address_line_2,
         city,
         state,
         postal_code,
         country,
         latitude,
         longitude,
         is_default
       )
       SELECT
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         COALESCE($8, 'India'),
         $9,
         $10,
         COALESCE($11, FALSE)
       WHERE EXISTS (
         SELECT 1
         FROM users
         WHERE id = $1
           AND deleted_at IS NULL
       )
       RETURNING ${ADDRESS_PROJECTION}`,
      [
        userId,
        data.label,
        data.addressLine1,
        data.addressLine2 ?? null,
        data.city,
        data.state,
        data.postalCode,
        data.country ?? null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.isDefault ?? false,
      ],
    );

    const address = result.rows[0];

    if (!address) {
      throw new Error('Address insert failed: user does not exist or is inactive');
    }

    return address;
  }

  async updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressData,
  ): Promise<UserAddress | null> {
    const fields = Object.keys(data) as Array<keyof UpdateAddressData>;

    if (fields.length === 0) {
      const result = await this.pool.query<UserAddress>(
        `SELECT ${ADDRESS_PROJECTION}
         FROM user_addresses ua
         WHERE ua.user_id = $1
           AND ua.id = $2
           AND EXISTS (
             SELECT 1
             FROM users u
             WHERE u.id = ua.user_id
               AND u.deleted_at IS NULL
           )
         LIMIT 1`,
        [userId, addressId],
      );

      return result.rows[0] ?? null;
    }

    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const field of fields) {
      const column = ADDRESS_COLUMNS[field];

      if (!column) {
        continue;
      }

      values.push(data[field] === undefined ? null : data[field]);
      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length === 0) {
      return null;
    }

    values.push(userId);
    const userIdParam = values.length;

    values.push(addressId);
    const addressIdParam = values.length;

    const result = await this.pool.query<UserAddress>(
      `UPDATE user_addresses ua
       SET ${assignments.join(', ')},
           updated_at = NOW()
       WHERE ua.user_id = $${userIdParam}
         AND ua.id = $${addressIdParam}
         AND EXISTS (
           SELECT 1
           FROM users u
           WHERE u.id = ua.user_id
             AND u.deleted_at IS NULL
         )
       RETURNING ${ADDRESS_PROJECTION}`,
      values,
    );

    return result.rows[0] ?? null;
  }

  async findAddresses(userId: string): Promise<UserAddress[]> {
    const result = await this.pool.query<UserAddress>(
      `SELECT ${ADDRESS_PROJECTION}
       FROM user_addresses ua
       WHERE ua.user_id = $1
         AND EXISTS (
           SELECT 1
           FROM users u
           WHERE u.id = ua.user_id
             AND u.deleted_at IS NULL
         )
       ORDER BY ua.is_default DESC, ua.created_at DESC`,
      [userId],
    );

    return result.rows;
  }

  async findPreferences(userId: string): Promise<UserPreferences | null> {
    const result = await this.pool.query<UserPreferences>(
      `SELECT ${PREFERENCES_PROJECTION}
       FROM user_preferences up
       WHERE up.user_id = $1
         AND EXISTS (
           SELECT 1
           FROM users u
           WHERE u.id = up.user_id
             AND u.deleted_at IS NULL
         )
       LIMIT 1`,
      [userId],
    );

    return result.rows[0] ?? null;
  }

  async updatePreferences(
    userId: string,
    data: UpdateUserPreferencesData,
  ): Promise<UserPreferences | null> {
    const fields = Object.keys(data) as Array<keyof UpdateUserPreferencesData>;

    if (fields.length === 0) {
      return this.findPreferences(userId);
    }

    const columns: string[] = [];
    const values: unknown[] = [];

    for (const field of fields) {
      const column = PREFERENCE_COLUMNS[field];

      if (!column) {
        continue;
      }

      columns.push(column);
      values.push(data[field]);
    }

    if (columns.length === 0) {
      return this.findPreferences(userId);
    }

    const insertValues = values.map((_, index) => `$${index + 1}`).join(', ');
    const userIdParam = values.length + 1;

    const assignments = columns.map((column, index) => `${column} = $${index + 1}`).join(', ');

    const result = await this.pool.query<UserPreferences>(
      `INSERT INTO user_preferences (
         user_id,
         ${columns.join(', ')}
       )
       SELECT
         $${userIdParam},
         ${insertValues}
       WHERE EXISTS (
         SELECT 1
         FROM users
         WHERE id = $${userIdParam}
           AND deleted_at IS NULL
       )
       ON CONFLICT (user_id)
       DO UPDATE SET
         ${assignments},
         updated_at = NOW()
       RETURNING ${PREFERENCES_PROJECTION}`,
      [...values, userId],
    );

    return result.rows[0] ?? null;
  }

  async findHistory(userId: string, limit: number): Promise<UserHistoryEntry[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

    const result = await this.pool.query<UserHistoryEntry>(
      `SELECT
         id,
         user_id AS "userId",
         event_type AS "eventType",
         entity_type AS "entityType",
         entity_id AS "entityId",
         created_at AS "createdAt"
       FROM user_history uh
       WHERE uh.user_id = $1
         AND EXISTS (
           SELECT 1
           FROM users u
           WHERE u.id = uh.user_id
             AND u.deleted_at IS NULL
         )
       ORDER BY uh.created_at DESC
       LIMIT $2`,
      [userId, safeLimit],
    );

    return result.rows;
  }
}
