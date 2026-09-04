const PHONE_ALLOWED_CHARACTERS = /[^\d+]/g;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  const normalized = phone.trim().replace(PHONE_ALLOWED_CHARACTERS, '');

  return normalized;
}
