import type { JWTPayload } from 'jose';

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  role: string;
  type: 'access';
  /** Stable refresh family; retained when a refresh token rotates. */
  sid?: string;
}
