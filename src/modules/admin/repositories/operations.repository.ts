import type { Pool } from 'pg';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error.js';
import { accountDisplayNameSql } from '../../users/repositories/account-identity.js';

import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
import { PostgresCouponRepository } from '../../coupons/repositories/coupon.repository.js';
import {
  adminCouponSchema,
  couponActivationSchema,
} from '../../coupons/schemas/admin-coupon.schema.js';

// Explicit projections deliberately exclude PINs, provider payloads, credentials and bank details.
export const operationSources = {
  commission: {
    table: 'rides',
    columns: `id, assigned_driver_id, status,
       CASE WHEN jsonb_typeof(route_metadata->'bookingFareSnapshot'->'grossAmount')='number' THEN (route_metadata->'bookingFareSnapshot'->>'grossAmount')::numeric END AS booking_gross_paise,
       CASE WHEN jsonb_typeof(route_metadata->'bookingFareSnapshot'->'commissionAmount')='number' THEN (route_metadata->'bookingFareSnapshot'->>'commissionAmount')::numeric END AS booking_commission_paise,
       CASE WHEN jsonb_typeof(route_metadata->'bookingFareSnapshot'->'driverEarnings')='number' THEN (route_metadata->'bookingFareSnapshot'->>'driverEarnings')::numeric END AS booking_driver_earnings_paise,
       CASE WHEN route_metadata->'bookingFareSnapshot'->>'currency' ~ '^[A-Z]{3}$' THEN route_metadata->'bookingFareSnapshot'->>'currency' END AS currency,
       created_at, completed_at`,
    status: 'status',
    search: 'id::text',
    statuses: ['completed'],
  },
  refunds: {
    table: 'payment_refunds',
    columns: 'id, payment_id, amount, currency, status, created_at, processed_at',
    status: null,
    search: 'payment_id::text',
    statuses: [],
  },
  rides: {
    table: 'rides',
    columns:
      'id, customer_id, assigned_driver_id, assigned_vehicle_id, sector, vehicle_category, status, pickup_address, destination_address, fare_estimate, final_fare, actual_distance_meters, created_at, updated_at',
    status: 'status',
    search: 'id::text',
    statuses: [
      'requested',
      'searching',
      'driver_assigned',
      'driver_arriving',
      'driver_arrived',
      'in_progress',
      'completed',
      'cancelled',
    ],
  },
  logistics: {
    table: 'logistics_orders',
    columns:
      'id, user_id, status, scheduled_pickup_at, delivered_at, cancelled_at, created_at, updated_at',
    status: 'status',
    search: 'id::text',
    statuses: [
      'PENDING',
      'CONFIRMED',
      'ASSIGNED',
      'PICKUP_IN_PROGRESS',
      'PICKED_UP',
      'IN_TRANSIT',
      'DELIVERED',
      'CANCELLED',
      'FAILED',
    ],
  },
  rentals: {
    table: 'rentals',
    columns:
      'id, user_id, vehicle_id, start_at, end_at, status, total_amount, currency, created_at, updated_at',
    status: 'status',
    search: 'id::text',
    statuses: ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'],
  },
  payments: {
    table: 'payments',
    columns:
      'id, user_id, ride_id, rental_id, logistics_order_id, status, amount, currency, initiated_at, captured_at, refunded_at, created_at, updated_at',
    status: 'status',
    search: 'id::text',
    statuses: ['INITIATED', 'AUTHORIZED', 'CAPTURED', 'REFUNDED', 'FAILED'],
  },
  wallets: {
    table: 'provider_wallets',
    columns: 'user_id AS id, balance_paise, currency, updated_at AS created_at',
    status: null,
    search: 'user_id::text',
    statuses: [],
  },
  transactions: {
    table: 'provider_wallet_entries',
    columns: 'id, user_id, amount_paise, balance_after_paise, entry_type, actor_id, created_at',
    status: 'entry_type',
    search: 'id::text',
    statuses: ['EARNING', 'COMMISSION', 'ADJUSTMENT', 'PAYOUT_RESERVE', 'PAYOUT_REFUND'],
  },
  settlements: {
    table: 'provider_payouts',
    columns: 'id, user_id, amount_paise, status, created_at, updated_at',
    status: 'status',
    search: 'id::text',
    statuses: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'],
  },
  coupons: {
    table: 'coupons',
    columns:
      'id, code, discount_type, discount_value, max_discount_amount, min_fare_amount, usage_limit, per_user_limit, starts_at, expires_at, is_active, usage_count, created_at, updated_at, updated_at::text AS version_timestamp',
    status: null,
    search: 'code',
    statuses: [],
  },
  notifications: {
    table: 'notifications',
    columns:
      'id, user_id, notification_type, channel, processing_status, delivery_status, attempt_count, created_at, updated_at',
    status: 'delivery_status',
    search: 'notification_type',
    statuses: ['PENDING', 'SENT', 'DELIVERED', 'FAILED'],
  },
  support: {
    table: 'support_tickets',
    columns:
      'id, ticket_number, user_id, role, category, subject, message, status, created_at, updated_at',
    status: 'status',
    search: 'subject',
    statuses: ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'],
  },
  activity: {
    table: 'user_history',
    columns: 'id, user_id, event_type, entity_type, entity_id, created_at',
    status: null,
    search: 'event_type',
    statuses: [],
  },
} as const;
export type OperationModule = keyof typeof operationSources;
const operationAccounts: Partial<Record<OperationModule, string>> = {
  rides: 'page.customer_id',
  logistics: 'page.user_id',
  rentals: 'page.user_id',
  payments: 'page.user_id',
  wallets: 'page.id',
  transactions: 'page.user_id',
  settlements: 'page.user_id',
  notifications: 'page.user_id',
  support: 'page.user_id',
  activity: 'page.user_id',
  commission: '(SELECT d.user_id FROM driver_profiles d WHERE d.id=page.assigned_driver_id)',
  refunds: '(SELECT p.user_id FROM payments p WHERE p.id=page.payment_id)',
};
export const operationModuleSchema = z.enum(
  Object.keys(operationSources) as [OperationModule, ...OperationModule[]],
);
export const operationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(4000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().min(1).max(150).optional(),
    recordId: z.string().uuid().optional(),
    status: z.string().max(40).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'Invalid date range');
export type OperationQuery = z.infer<typeof operationQuerySchema>;

export class AdminOperationsRepository {
  constructor(private readonly pool: Pool) {}
  authorize(userId: string, role: string) {
    return new PostgresProviderOperationsRepository(this.pool).authorize(userId, role);
  }
  manageCoupon(actorId: string, input: unknown, id?: string) {
    return new PostgresCouponRepository(this.pool).manageByAdmin(
      actorId,
      id ? couponActivationSchema.parse(input) : adminCouponSchema.parse(input),
      id,
    );
  }
  async list(module: OperationModule, query: OperationQuery) {
    const source = operationSources[module];
    const values: unknown[] = [];
    const predicates: string[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return '$' + values.length;
    };
    if (query.recordId)
      predicates.push(`${module === 'wallets' ? 'user_id' : 'id'} = ${add(query.recordId)}::uuid`);
    if (query.search)
      predicates.push(
        `${source.search} ILIKE ${add('%' + query.search.replace(/[\\%_]/g, '\\$&') + '%')}`,
      );
    if (query.status) {
      if (!source.status || !(source.statuses as readonly string[]).includes(query.status))
        throw new Error('Invalid operation status');
      predicates.push(`${source.status}::text = ${add(query.status)}`);
    }
    const time = module === 'wallets' ? 'updated_at' : 'created_at';
    if (query.from) predicates.push(`${time} >= ${add(query.from)}::date`);
    if (query.to) predicates.push(`${time} < ${add(query.to)}::date + interval '1 day'`);
    const where = predicates.length ? ' WHERE ' + predicates.join(' AND ') : '';
    const account = operationAccounts[module];
    // Resolve only the bounded page, not every row counted by the filter.
    const visible = account
      ? `SELECT page.*,identity.display_name AS account_display_name,identity.account_role
      FROM page LEFT JOIN LATERAL(SELECT ${accountDisplayNameSql} AS display_name,u.role::text AS account_role
        FROM users u LEFT JOIN partners owner ON owner.user_id=u.id WHERE u.id=${account}) identity ON TRUE`
      : 'SELECT * FROM page';
    // A single statement gives count and rows the same MVCC snapshot, including empty pages.
    const result = await this.pool.query<{ items: Record<string, unknown>[]; total: number }>(
      `WITH filtered AS (SELECT ${source.columns} FROM ${source.table}${where}),
       page AS (SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}),
       visible AS (${visible})
       SELECT COALESCE((SELECT jsonb_agg(visible ORDER BY created_at DESC,id DESC) FROM visible),'[]'::jsonb) AS items,
       (SELECT COUNT(*)::int FROM filtered) AS total`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const row = result.rows[0];
    if (!row)
      throw new AppError('OPERATIONAL_DATA_UNAVAILABLE', 'Operational records unavailable', 503);
    return { ...row, page: query.page, pageSize: query.pageSize };
  }
  async summary(from?: string, to?: string, includeFinance = false) {
    const values: string[] = [];
    const filters: string[] = [];
    if (from) {
      values.push(from);
      filters.push(`created_at >= $${values.length}::date`);
    }
    if (to) {
      values.push(to);
      filters.push(`created_at < $${values.length}::date + interval '1 day'`);
    }
    const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
    const [rides, deliveries, payments, rentals, categories, receiptSeries] = await Promise.all([
      this.pool.query(
        `SELECT status, COUNT(*)::int AS count FROM rides${where} GROUP BY status ORDER BY status`,
        values,
      ),
      this.pool.query(
        `SELECT status, COUNT(*)::int AS count FROM logistics_orders${where} GROUP BY status ORDER BY status`,
        values,
      ),
      includeFinance
        ? this.pool.query(
            `SELECT currency, SUM(amount)::text AS amount, COUNT(*)::int AS count FROM payments${where}${where ? ' AND' : ' WHERE'} status = 'CAPTURED' GROUP BY currency ORDER BY currency`,
            values,
          )
        : Promise.resolve(null),
      this.pool.query(
        `SELECT status,COUNT(*)::int AS count FROM rentals${where} GROUP BY status ORDER BY status`,
        values,
      ),
      this.pool.query(
        `SELECT COALESCE(vehicle_category,'Unspecified') AS category,COUNT(*)::int AS count,(SUM(COUNT(*)) OVER())::int AS total FROM rides${where} GROUP BY vehicle_category ORDER BY count DESC,category LIMIT 10`,
        values,
      ),
      includeFinance
        ? this.pool.query(
            `SELECT to_char(created_at,'YYYY-MM') AS month,currency,SUM(amount)::text AS amount FROM payments${where}${where ? ' AND' : ' WHERE'} status='CAPTURED' GROUP BY month,currency ORDER BY month,currency`,
            values,
          )
        : Promise.resolve(null),
    ]);
    return {
      rides: rides.rows,
      deliveries: deliveries.rows,
      capturedPayments: payments?.rows ?? null,
      financeAvailable: includeFinance,
      rentals: rentals.rows,
      vehicleCategories: categories.rows,
      receiptSeries: receiptSeries?.rows ?? null,
    };
  }
}
