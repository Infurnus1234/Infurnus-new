export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicUser = User;

export interface CreateUserData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export type UpdateUserData = Partial<CreateUserData>;
