export interface LoginInput {
  email?: string;
  phone?: string;
  password?: string | undefined;
}

export interface LoginResult {
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}
