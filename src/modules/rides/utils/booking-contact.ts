import { env } from '../../../config/env.js';

/** Participant booking payloads never carry either party's personal contact numbers. */
export function privateBookingPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map(privateBookingPayload) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/phone|mobile|contactNumber/i.test(key))
      .map(([key, field]) => [key, privateBookingPayload(field)]),
  ) as T;
}
export function customerBookingPayload<T extends object>(value: T): T & { callingNumber: string } {
  return { ...privateBookingPayload(value), callingNumber: env.INFURNUS_CALLING_NUMBER };
}
