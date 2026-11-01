import { z } from 'zod';
import { normalizeEmail, normalizePhone } from '../../auth/utils/contact.js';

const optionalContact = (value: unknown) =>
  typeof value === 'string' && !value.trim() ? undefined : value;
export const managedDriverContactsSchema = z
  .object({
    email: z.preprocess(
      optionalContact,
      z.string().trim().email().max(320).transform(normalizeEmail).optional(),
    ),
    phone: z.preprocess(
      optionalContact,
      z
        .string()
        .trim()
        .regex(/^[+\d\s()-]+$/, 'Enter a country-coded phone number')
        .transform(normalizePhone)
        .transform((value) => (value.startsWith('+') ? value : `+${value}`))
        .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid country-coded phone number'))
        .optional(),
    ),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    path: ['email'],
    message: 'Phone number or email address is required',
  });
