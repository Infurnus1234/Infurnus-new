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

export const userAddressParamsSchema = z
  .object({ id: z.string().uuid(), addressId: z.string().uuid() })
  .strict();

const addressFields = {
  label: z.string().trim().min(1).max(30),
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().trim().max(255).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(1).max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
};

export const createAddressSchema = z
  .object(addressFields)
  .strict()
  .superRefine((value, context) => {
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Latitude and longitude must be provided together',
      });
    }
  });

export const updateAddressSchema = z
  .object(addressFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .superRefine((value, context) => {
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Latitude and longitude must be provided together',
      });
    }
  });

export const updatePreferencesSchema = z
  .object({
    pushNotificationsEnabled: z.boolean().optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    smsNotificationsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
