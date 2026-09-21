import { z } from 'zod';

export const createSupportTicketSchema = z
  .object({
    category: z.string().trim().min(2, 'Category is required').max(50),
    subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(200),
    message: z.string().trim().min(5, 'Message must be at least 5 characters').max(5000),
  })
  .strict();

export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

export const supportTicketIdSchema = z.object({
  id: z.string().uuid('Invalid ticket ID'),
});
