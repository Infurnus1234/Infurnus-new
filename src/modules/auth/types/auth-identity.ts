export type AuthUserStatus = 'active' | 'suspended' | 'banned';

export interface AuthUserIdentity {
  publicId?: string | null;
  id: string;
  role: string;
  status: AuthUserStatus;
}
