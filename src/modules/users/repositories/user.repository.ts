import type { Pool } from 'pg';
import type { CreateUserData, PublicUser, UpdateUserData } from '../types/user.js';

export interface UserRepository {
  create(data: CreateUserData): Promise<PublicUser>;
  findById(id: string): Promise<PublicUser | null>;
  update(id: string, data: UpdateUserData): Promise<PublicUser | null>;
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
}
