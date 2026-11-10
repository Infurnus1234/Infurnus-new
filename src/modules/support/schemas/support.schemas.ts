import { z } from 'zod';

export const createSupportTicketSchema = z
  .object({
    requestId: z
      .string({ error: 'Submission identifier must be text.' })
      .regex(
        /^[a-f0-9]{32}$/,
        'Submission identifier must contain 32 lowercase hexadecimal characters.',
      )
      .optional(),
    category: z
      .string({ error: 'Category is required and must be text.' })
      .trim()
      .min(2, 'Category must be at least 2 characters.')
      .max(50, 'Category must be at most 50 characters.'),
    subject: z
      .string({ error: 'Subject is required and must be text.' })
      .trim()
      .min(3, 'Subject must be at least 3 characters.')
      .max(200, 'Subject must be at most 200 characters.'),
    message: z
      .string({ error: 'Message is required and must be text.' })
      .trim()
      .min(5, 'Message must be at least 5 characters.')
      .max(5000, 'Message must be at most 5000 characters.'),
  })
  .strict();

export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
export const supportListSchema = z
  .object({
    page: z.coerce
      .number({ error: 'Page must be a number.' })
      .int('Page must be a whole number.')
      .min(1, 'Page must be at least 1.')
      .max(4000, 'Page must be at most 4000.')
      .default(1),
    pageSize: z.coerce
      .number({ error: 'Page size must be a number.' })
      .int('Page size must be a whole number.')
      .min(1, 'Page size must be at least 1.')
      .max(100, 'Page size must be at most 100.')
      .default(25),
    includePagination: z
      .literal('true', { error: 'Include pagination must be true when supplied.' })
      .optional(),
  })
  .strict();
export type SupportListQuery = z.infer<typeof supportListSchema>;

export const supportTicketIdSchema = z.object({
  id: z.union(
    [
      z.string().uuid('Invalid ticket ID'),
      z.string().regex(/^(?:INF-SUP-[0-9]{6,19}|TCK-[a-zA-Z0-9-]{1,26})$/),
    ],
    { error: 'Ticket reference must be a valid ticket ID or ticket number.' },
  ),
});

export const supportStatuses = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'] as const;
export const supportStatusUpdateSchema = z
  .object({
    status: z.enum(supportStatuses, {
      error: 'Status must be OPEN, UNDER_REVIEW, RESOLVED or CLOSED.',
    }),
    expectedVersion: z
      .number({ error: 'Ticket version is required and must be a number.' })
      .int('Ticket version must be a whole number.')
      .positive('Ticket version must be positive.'),
  })
  .strict();
export const supportTransitions: Record<string, readonly string[]> = {
  OPEN: ['UNDER_REVIEW', 'RESOLVED'],
  UNDER_REVIEW: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};
