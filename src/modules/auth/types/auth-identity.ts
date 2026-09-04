export type AuthUserStatus = 'active' | 'suspended' | 'banned';

export interface AuthUserIdentity {
  id: string;
  role: string;
  status: AuthUserStatus;
}
