import type { Pool } from 'pg';
import type {
  CreateAddressData,
  CreateUserData,
  PublicUser,
  UpdateAddressData,
  UpdateUserData,
  UserAddress,
  UserHistoryEntry,
  UserPreferences,
  UpdateUserPreferencesData,
} from '../types/user.js';

export interface UserRepository {
  create(data: CreateUserData): Promise<PublicUser>;
  findById(id: string): Promise<PublicUser | null>;
  update(id: string, data: UpdateUserData): Promise<PublicUser | null>;
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

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreateUserData): Promise<PublicUser> {
    const result = await this.pool.query<PublicUser>(
      `INSERT INTO users (first_name, last_name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, first_name AS "firstName", last_name AS "lastName",
                 email, phone, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [data.firstName, data.lastName, data.email, data.phone],
    );
    const user = result.rows.at(0);
    if (!user) {
      throw new Error('User insert returned no row');
    }
    return user;
  }

  async findById(id: string): Promise<PublicUser | null> {
    const result = await this.pool.query<PublicUser>(
      `SELECT id, first_name AS "firstName", last_name AS "lastName",
              email, phone, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async update(id: string, data: UpdateUserData): Promise<PublicUser | null> {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const columns: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      email: 'email',
      phone: 'phone',
    };
    const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);
    const result = await this.pool.query<PublicUser>(
      `UPDATE users SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING id, first_name AS "firstName", last_name AS "lastName",
                 email, phone, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [...values, id],
    );
    return result.rows[0] ?? null;
  }

  async createAddress(userId: string, data: CreateAddressData): Promise<UserAddress> {
    const result = await this.pool.query<UserAddress>(
      `INSERT INTO user_addresses
         (user_id, label, address_line_1, address_line_2, city, state, postal_code,
          country, latitude, longitude, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'India'), $9, $10, COALESCE($11, FALSE))
       RETURNING id, user_id AS "userId", label, address_line_1 AS "addressLine1",
                 address_line_2 AS "addressLine2", city, state, postal_code AS "postalCode",
                 country, latitude, longitude, is_default AS "isDefault",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
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
    const address = result.rows.at(0);
    if (!address) throw new Error('Address insert returned no row');
    return address;
  }

  async updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressData,
  ): Promise<UserAddress | null> {
    const columns: Record<string, string> = {
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
    };
    const fields = Object.keys(data);
    const values = Object.values(data).map((value) => (value === undefined ? null : value));
    const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);
    const result = await this.pool.query<UserAddress>(
      `UPDATE user_addresses SET ${assignments.join(', ')}
       WHERE user_id = $${values.length + 1} AND id = $${values.length + 2}
       RETURNING id, user_id AS "userId", label, address_line_1 AS "addressLine1",
                 address_line_2 AS "addressLine2", city, state, postal_code AS "postalCode",
                 country, latitude, longitude, is_default AS "isDefault",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [...values, userId, addressId],
    );
    return result.rows[0] ?? null;
  }

  async findAddresses(userId: string): Promise<UserAddress[]> {
    const result = await this.pool.query<UserAddress>(
      `SELECT id, user_id AS "userId", label, address_line_1 AS "addressLine1",
              address_line_2 AS "addressLine2", city, state, postal_code AS "postalCode",
              country, latitude, longitude, is_default AS "isDefault",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async findPreferences(userId: string): Promise<UserPreferences | null> {
    const result = await this.pool.query<UserPreferences>(
      `SELECT user_id AS "userId", push_notifications_enabled AS "pushNotificationsEnabled",
              email_notifications_enabled AS "emailNotificationsEnabled",
              sms_notifications_enabled AS "smsNotificationsEnabled",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM user_preferences WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async updatePreferences(
    userId: string,
    data: UpdateUserPreferencesData,
  ): Promise<UserPreferences | null> {
    const columns: Record<string, string> = {
      pushNotificationsEnabled: 'push_notifications_enabled',
      emailNotificationsEnabled: 'email_notifications_enabled',
      smsNotificationsEnabled: 'sms_notifications_enabled',
    };
    const fields = Object.keys(data);
    const values = Object.values(data);
    const assignments = fields.map((field, index) => `${columns[field]} = $${index + 1}`);
    const result = await this.pool.query<UserPreferences>(
      `INSERT INTO user_preferences (user_id, ${fields.map((field) => columns[field]).join(', ')})
       VALUES ($${values.length + 1}, ${values.map((_, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${assignments.join(', ')}
       RETURNING user_id AS "userId", push_notifications_enabled AS "pushNotificationsEnabled",
                 email_notifications_enabled AS "emailNotificationsEnabled",
                 sms_notifications_enabled AS "smsNotificationsEnabled",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [...values, userId],
    );
    return result.rows[0] ?? null;
  }

  async findHistory(userId: string, limit: number): Promise<UserHistoryEntry[]> {
    const result = await this.pool.query<UserHistoryEntry>(
      `SELECT id, user_id AS "userId", event_type AS "eventType",
              entity_type AS "entityType", entity_id AS "entityId",
              created_at AS "createdAt"
       FROM user_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows;
  }
}
