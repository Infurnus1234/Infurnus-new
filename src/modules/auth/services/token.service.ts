import { signAccessToken } from '../utils/jwt.js';
import type { AccessTokenPayload } from '../types/token.js';

export interface AccessTokenInput {
  userId: string;
  role: string;
}

export class TokenService {
  async createAccessToken(input: AccessTokenInput): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: input.userId,
      role: input.role,
      type: 'access',
    };

    return signAccessToken(payload);
  }
}
