import { z } from 'zod';

const name = z.string().trim().min(1).max(100);
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const phone = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Invalid phone number');

export const createUserSchema = z
  .object({
    firstName: name,
    lastName: name,
    email,
    phone,
  })
  .strict();

export const updateUserSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    email: email.optional(),
    phone: phone.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const userIdSchema = z.object({ id: z.string().uuid() }).strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
