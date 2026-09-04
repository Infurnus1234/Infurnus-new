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

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface UserAddress {
  id: string;
  userId: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAddressData {
  label: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  postalCode: string;
  country?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  isDefault?: boolean | undefined;
}

export interface UpdateAddressData {
  label?: string | undefined;
  addressLine1?: string | undefined;
  addressLine2?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  country?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  isDefault?: boolean | undefined;
}

export interface UserPreferences {
  userId: string;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateUserPreferencesData {
  pushNotificationsEnabled?: boolean | undefined;
  emailNotificationsEnabled?: boolean | undefined;
  smsNotificationsEnabled?: boolean | undefined;
}

export interface UserHistoryEntry {
  id: string;
  userId: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
}
