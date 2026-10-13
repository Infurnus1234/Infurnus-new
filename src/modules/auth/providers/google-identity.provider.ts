import { emailSchema } from '../schemas/auth.schemas.js';
import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';

export interface GoogleIdentity {
  subject: string;
  email: string;
  firstName: string | undefined;
  lastName: string | undefined;
}

export class GoogleIdentityProvider {
  constructor(
    private readonly client = new OAuth2Client(),
    private readonly audiences = [env.GOOGLE_WEB_CLIENT_ID, env.GOOGLE_ANDROID_CLIENT_ID].filter(
      (value): value is string => Boolean(value),
    ),
  ) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (env.NODE_ENV !== 'production' && idToken.startsWith('DEV_MOCK_GOOGLE_ID_TOKEN')) {
      return {
        subject: 'google-dev-subject-123456',
        email: 'user@infurnus.com',
        firstName: 'Infurnus',
        lastName: 'Customer',
      };
    }

    if (!this.audiences.length)
      throw new AppError(
        'GOOGLE_AUTH_NOT_CONFIGURED',
        'Google authentication is not configured',
        503,
      );
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.audiences });
      const claims = ticket.getPayload();
      if (
        !claims ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
        !this.audiences.includes(claims.aud) ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= Date.now() / 1000 ||
        typeof claims.sub !== 'string' ||
        !claims.sub.length ||
        claims.sub.length > 255 ||
        claims.email_verified !== true ||
        typeof claims.email !== 'string' ||
        !emailSchema.safeParse(claims.email).success
      )
        throw new AppError('INVALID_GOOGLE_TOKEN', 'Invalid or expired Google ID token', 401);
      return {
        subject: claims.sub,
        email: claims.email.toLowerCase(),
        firstName: claims.given_name,
        lastName: claims.family_name,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Library verification messages can contain the entire token. Never forward or log them.
      const invalid =
        error instanceof Error &&
        /^(Wrong number of segments|Can't parse token|No pem found|Invalid token signature|No issue time|No expiration time|iat field|exp field|Expiration time too far|Token used too|Invalid issuer|Wrong recipient)/.test(
          error.message,
        );
      throw new AppError(
        invalid ? 'INVALID_GOOGLE_TOKEN' : 'GOOGLE_AUTH_UNAVAILABLE',
        invalid
          ? 'Invalid or expired Google ID token'
          : 'Google authentication is temporarily unavailable',
        invalid ? 401 : 503,
      );
    }
  }
}
