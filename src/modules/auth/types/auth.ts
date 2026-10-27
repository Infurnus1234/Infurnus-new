export interface AuthenticatedUser {
  userId: string;
  role: string;
  sessionId?: string;
}
