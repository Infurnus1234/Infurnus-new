import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
import type { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import type { CreateRefreshTokenData } from '../types/refresh-token.js';
import type { RefreshTokenContext, RotatedRefreshToken } from '../types/refresh-token-service.js';
import { generateRefreshToken, hashRefreshToken } from '../utils/refresh-token.js';

function parseDurationToMilliseconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);

  if (!match) {
    throw new Error('JWT_REFRESH_EXPIRES_IN must use a duration such as 30d, 24h, 60m, or 3600s');
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (!unit) {
    throw new Error('JWT_REFRESH_EXPIRES_IN must include a valid duration unit');
  }

  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  const multiplier = multipliers[unit];

  if (multiplier === undefined) {
    throw new Error('JWT_REFRESH_EXPIRES_IN must use a duration such as 30d, 24h, 60m, or 3600s');
  }

  return amount * multiplier;
}

export class RefreshTokenService {
  constructor(private readonly repository: RefreshTokenRepository) {}

  async create(
    userId: string,
    context: RefreshTokenContext = {},
    familyId = randomUUID(),
  ): Promise<RotatedRefreshToken> {
    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);

    const expiresAt = new Date(
      Date.now() + parseDurationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN),
    );

    const data: CreateRefreshTokenData = {
      userId,
      tokenHash,
      familyId,
      expiresAt,
      userAgent: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
    };

    const record = await this.repository.create(data);

    return {
      refreshToken,
      refreshTokenId: record.id,
      familyId: record.familyId,
      userId: record.userId,
      expiresAt: record.expiresAt,
    };
  }

  async rotate(
    rawRefreshToken: string,
    context: RefreshTokenContext = {},
  ): Promise<RotatedRefreshToken> {
    if (!rawRefreshToken) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', 401);
    }

    const oldTokenHash = hashRefreshToken(rawRefreshToken);
    const newRefreshToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRefreshToken);

    const newExpiresAt = new Date(
      Date.now() + parseDurationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN),
    );

    const result = await this.repository.rotate(oldTokenHash, {
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
      userAgent: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
    });

    if (result.status === 'reuse_detected') {
      throw new AppError('REFRESH_TOKEN_REUSE_DETECTED', 'Refresh token reuse detected', 401);
    }

    if (result.status === 'expired' || result.status === 'not_found') {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401);
    }

    if (result.status !== 'rotated' || !result.token) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', 401);
    }

    return {
      refreshToken: newRefreshToken,
      refreshTokenId: result.token.id,
      familyId: result.token.familyId,
      userId: result.token.userId,
      expiresAt: result.token.expiresAt,
    };
  }
}
