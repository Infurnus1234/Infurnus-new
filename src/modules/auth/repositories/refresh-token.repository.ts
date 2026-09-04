import { pool, withTransaction } from '../../../infrastructure/database/postgres.js';
import type {
  CreateRefreshTokenData,
  RefreshTokenRecord,
  RotateRefreshTokenData,
} from '../types/refresh-token.js';

export interface RefreshTokenRepository {
  create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord>;

  findActiveByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;

  revoke(id: string, replacedBy?: string | null): Promise<RefreshTokenRecord | null>;

  revokeFamily(familyId: string): Promise<void>;

  revokeAllForUser(userId: string): Promise<void>;

  rotate(
    oldTokenHash: string,
    newToken: RotateRefreshTokenData,
  ): Promise<{
    status: 'rotated' | 'not_found' | 'expired' | 'reuse_detected';
    token?: RefreshTokenRecord;
  }>;
}

export class PostgresRefreshTokenRepository implements RefreshTokenRepository {
  async create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord> {
    const result = await pool.query<RefreshTokenRecord>(
      `
        INSERT INTO refresh_tokens (
          user_id,
          token_hash,
          family_id,
          expires_at,
          user_agent,
          ip_address
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          user_id AS "userId",
          token_hash AS "tokenHash",
          family_id AS "familyId",
          issued_at AS "issuedAt",
          expires_at AS "expiresAt",
          revoked_at AS "revokedAt",
          replaced_by AS "replacedBy",
          user_agent AS "userAgent",
          ip_address AS "ipAddress",
          created_at AS "createdAt"
      `,
      [
        data.userId,
        data.tokenHash,
        data.familyId,
        data.expiresAt,
        data.userAgent ?? null,
        data.ipAddress ?? null,
      ],
    );

    return result.rows[0];
  }

  async findActiveByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const result = await pool.query<RefreshTokenRecord>(
      `
        SELECT
          id,
          user_id AS "userId",
          token_hash AS "tokenHash",
          family_id AS "familyId",
          issued_at AS "issuedAt",
          expires_at AS "expiresAt",
          revoked_at AS "revokedAt",
          replaced_by AS "replacedBy",
          user_agent AS "userAgent",
          ip_address AS "ipAddress",
          created_at AS "createdAt"
        FROM refresh_tokens
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `,
      [tokenHash],
    );

    return result.rows[0] ?? null;
  }

  async revoke(id: string, replacedBy: string | null = null): Promise<RefreshTokenRecord | null> {
    const result = await pool.query<RefreshTokenRecord>(
      `
        UPDATE refresh_tokens
        SET
          revoked_at = NOW(),
          replaced_by = $2
        WHERE id = $1
          AND revoked_at IS NULL
        RETURNING
          id,
          user_id AS "userId",
          token_hash AS "tokenHash",
          family_id AS "familyId",
          issued_at AS "issuedAt",
          expires_at AS "expiresAt",
          revoked_at AS "revokedAt",
          replaced_by AS "replacedBy",
          user_agent AS "userAgent",
          ip_address AS "ipAddress",
          created_at AS "createdAt"
      `,
      [id, replacedBy],
    );

    return result.rows[0] ?? null;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await pool.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE family_id = $1
          AND revoked_at IS NULL
      `,
      [familyId],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await pool.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE user_id = $1
          AND revoked_at IS NULL
      `,
      [userId],
    );
  }

  async rotate(
    oldTokenHash: string,
    newToken: RotateRefreshTokenData,
  ): Promise<{
    status: 'rotated' | 'not_found' | 'expired' | 'reuse_detected';
    token?: RefreshTokenRecord;
  }> {
    return withTransaction(async (client) => {
      const result = await client.query<RefreshTokenRecord>(
        `
          SELECT
            id,
            user_id AS "userId",
            token_hash AS "tokenHash",
            family_id AS "familyId",
            issued_at AS "issuedAt",
            expires_at AS "expiresAt",
            revoked_at AS "revokedAt",
            replaced_by AS "replacedBy",
            user_agent AS "userAgent",
            ip_address AS "ipAddress",
            created_at AS "createdAt"
          FROM refresh_tokens
          WHERE token_hash = $1
          FOR UPDATE
        `,
        [oldTokenHash],
      );

      const existing = result.rows[0];

      if (!existing) {
        return { status: 'not_found' as const };
      }

      if (existing.revokedAt !== null) {
        await client.query(
          `
            UPDATE refresh_tokens
            SET revoked_at = NOW()
            WHERE family_id = $1
              AND revoked_at IS NULL
          `,
          [existing.familyId],
        );

        return { status: 'reuse_detected' as const };
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        return { status: 'expired' as const };
      }

      const created = await client.query<RefreshTokenRecord>(
        `
          INSERT INTO refresh_tokens (
            user_id,
            token_hash,
            family_id,
            expires_at,
            user_agent,
            ip_address
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            user_id AS "userId",
            token_hash AS "tokenHash",
            family_id AS "familyId",
            issued_at AS "issuedAt",
            expires_at AS "expiresAt",
            revoked_at AS "revokedAt",
            replaced_by AS "replacedBy",
            user_agent AS "userAgent",
            ip_address AS "ipAddress",
            created_at AS "createdAt"
        `,
        [
          existing.userId,
          newToken.tokenHash,
          existing.familyId,
          newToken.expiresAt,
          newToken.userAgent ?? existing.userAgent,
          newToken.ipAddress ?? existing.ipAddress,
        ],
      );

      await client.query(
        `
          UPDATE refresh_tokens
          SET
            revoked_at = NOW(),
            replaced_by = $1
          WHERE id = $2
            AND revoked_at IS NULL
        `,
        [created.rows[0].id, existing.id],
      );

      return {
        status: 'rotated' as const,
        token: created.rows[0],
      };
    });
  }
}
