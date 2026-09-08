import { AppError } from '../../../common/errors/app-error.js';
import type { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import type { RefreshSessionRecord, RefreshSessionView } from '../types/refresh-session.js';

export class SessionService {
  constructor(private readonly repository: RefreshTokenRepository) {}

  async listActiveSessions(userId: string): Promise<RefreshSessionView[]> {
    if (!userId) {
      throw new AppError('INVALID_USER', 'Invalid user', 400);
    }

    const sessions = await this.repository.listActiveSessionsForUser(userId);

    return sessions.map((session: RefreshSessionRecord) => ({
      id: session.id,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    if (!userId) {
      throw new AppError('INVALID_USER', 'Invalid user', 400);
    }

    if (!sessionId) {
      throw new AppError('INVALID_SESSION', 'Invalid session', 400);
    }

    const revoked = await this.repository.revokeSessionForUser(userId, sessionId);

    if (!revoked) {
      throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);
    }
  }
}
