export interface RefreshTokenContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface RotatedRefreshToken {
  refreshToken: string;
  refreshTokenId: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
}
