import { signAccessToken } from '../utils/jwt.js';
import type { AccessTokenPayload } from '../types/token.js';

export interface AccessTokenInput {
  userId: string;
  role: string;
  sessionId?: string;
}

export class TokenService {
  async createAccessToken(input: AccessTokenInput): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: input.userId,
      role: input.role,
      type: 'access',
      ...(input.sessionId ? { sid: input.sessionId } : {}),
    };

    return signAccessToken(payload);
  }
}
