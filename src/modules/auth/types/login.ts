export interface LoginInput {
  email?: string;
  phone?: string;
  password: string;
}

export interface LoginResult {
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}
