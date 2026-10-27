import { z } from 'zod';

export const fleetReportQuerySchema = z
  .object({
    period: z.enum(['today', 'this_week', 'this_month', 'custom', 'all_time']).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    interval: z.enum(['day', 'week', 'month']).default('day'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    historyOffset: z.coerce.number().int().min(0).max(100000).default(0),
    vehicleOffset: z.coerce.number().int().min(0).max(100000).default(0),
    trendOffset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (
      q.from &&
      q.to &&
      (q.from > q.to || (Date.parse(q.to) - Date.parse(q.from)) / 86400000 > 3660)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Date range must be ordered and no wider than 3660 days',
      });
    if (q.period === 'custom' && (!q.from || !q.to))
      ctx.addIssue({ code: 'custom', message: 'Custom period requires both dates' });
    if (q.period && q.period !== 'custom' && (q.from || q.to))
      ctx.addIssue({ code: 'custom', message: 'Choose a preset or explicit dates, not both' });
  });
