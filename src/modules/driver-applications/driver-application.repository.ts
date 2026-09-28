import { pool } from '../../infrastructure/database/postgres.js';

import type {
  CreateDriverApplicationInput,
  DriverApplication,
  DriverApplicationFilters,
  ReviewDriverApplicationInput,
} from './driver-application.types.js';

export interface DriverApplicationRepository {
  create(input: CreateDriverApplicationInput): Promise<DriverApplication>;

  findById(id: string): Promise<DriverApplication | null>;

  findActiveByPartnerAndDriver(
    partnerId: string,
    driverProfileId: string,
  ): Promise<DriverApplication | null>;

  findByDriverProfileId(driverProfileId: string): Promise<DriverApplication | null>;

  list(filters: DriverApplicationFilters): Promise<{
    items: DriverApplication[];
    total: number;
  }>;

  updateStatus(
    id: string,
    review: ReviewDriverApplicationInput,
    reviewerId: string,
  ): Promise<DriverApplication | null>;
}

export class PostgresDriverApplicationRepository implements DriverApplicationRepository {
  async create(input: CreateDriverApplicationInput): Promise<DriverApplication> {
    const result = await pool.query<DriverApplication>(
      `
        INSERT INTO driver_applications (
          partner_id,
          driver_profile_id,
          requested_sector,
          requested_vehicle_category,
          vehicle_ownership_type,
          status,
          submitted_at
        )
        VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())
        RETURNING
          id,
          partner_id AS "partnerId",
          driver_profile_id AS "driverProfileId",
          requested_sector AS "requestedSector",
          requested_vehicle_category AS "requestedVehicleCategory",
          vehicle_ownership_type AS "vehicleOwnershipType",
          status,
          submitted_at AS "submittedAt",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason AS "reviewReason",
          approved_at AS "approvedAt",
          approved_by AS "approvedBy",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        input.partnerId,
        input.driverProfileId,
        input.requestedSector,
        input.requestedVehicleCategory,
        input.vehicleOwnershipType,
      ],
    );

    const application = result.rows[0];

    if (!application) {
      throw new Error('Failed to create driver application');
    }

    return application;
  }

  async findById(id: string): Promise<DriverApplication | null> {
    const result = await pool.query<DriverApplication>(
      `
        SELECT
          id,
          partner_id AS "partnerId",
          driver_profile_id AS "driverProfileId",
          requested_sector AS "requestedSector",
          requested_vehicle_category AS "requestedVehicleCategory",
          vehicle_ownership_type AS "vehicleOwnershipType",
          status,
          submitted_at AS "submittedAt",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason AS "reviewReason",
          approved_at AS "approvedAt",
          approved_by AS "approvedBy",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM driver_applications
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async findActiveByPartnerAndDriver(
    partnerId: string,
    driverProfileId: string,
  ): Promise<DriverApplication | null> {
    const result = await pool.query<DriverApplication>(
      `
        SELECT
          id,
          partner_id AS "partnerId",
          driver_profile_id AS "driverProfileId",
          requested_sector AS "requestedSector",
          requested_vehicle_category AS "requestedVehicleCategory",
          vehicle_ownership_type AS "vehicleOwnershipType",
          status,
          submitted_at AS "submittedAt",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason AS "reviewReason",
          approved_at AS "approvedAt",
          approved_by AS "approvedBy",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM driver_applications
        WHERE partner_id = $1
          AND driver_profile_id = $2
          AND status IN (
            'PENDING',
            'UNDER_REVIEW',
            'CHANGES_REQUESTED'
          )
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [partnerId, driverProfileId],
    );

    return result.rows[0] ?? null;
  }

  async findByDriverProfileId(driverProfileId: string): Promise<DriverApplication | null> {
    const result = await pool.query<DriverApplication>(
      `
        SELECT
          id,
          partner_id AS "partnerId",
          driver_profile_id AS "driverProfileId",
          requested_sector AS "requestedSector",
          requested_vehicle_category AS "requestedVehicleCategory",
          vehicle_ownership_type AS "vehicleOwnershipType",
          status,
          submitted_at AS "submittedAt",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason AS "reviewReason",
          approved_at AS "approvedAt",
          approved_by AS "approvedBy",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM driver_applications
        WHERE driver_profile_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [driverProfileId],
    );

    return result.rows[0] ?? null;
  }

  async list(filters: DriverApplicationFilters): Promise<{
    items: DriverApplication[];
    total: number;
  }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const addCondition = (condition: string, value: unknown): void => {
      values.push(value);

      conditions.push(condition.replace('?', `$${values.length}`));
    };

    if (filters.status) {
      addCondition('status = ?', filters.status);
    }

    if (filters.requestedSector) {
      addCondition('requested_sector = ?', filters.requestedSector);
    }

    if (filters.requestedVehicleCategory) {
      addCondition('requested_vehicle_category = ?', filters.requestedVehicleCategory);
    }

    if (filters.vehicleOwnershipType) {
      addCondition('vehicle_ownership_type = ?', filters.vehicleOwnershipType);
    }

    if (filters.partnerId) {
      addCondition('partner_id = ?', filters.partnerId);
    }

    if (filters.driverProfileId) {
      addCondition('driver_profile_id = ?', filters.driverProfileId);
    }

    if (filters.reviewedBy) {
      addCondition('reviewed_by = ?', filters.reviewedBy);
    }

    if (filters.approvedBy) {
      addCondition('approved_by = ?', filters.approvedBy);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const countResult = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM driver_applications
        ${whereClause}
      `,
      values,
    );

    const dataValues = [...values, limit, offset];

    const result = await pool.query<DriverApplication>(
      `
        SELECT
          id,
          partner_id AS "partnerId",
          driver_profile_id AS "driverProfileId",
          requested_sector AS "requestedSector",
          requested_vehicle_category AS "requestedVehicleCategory",
          vehicle_ownership_type AS "vehicleOwnershipType",
          status,
          submitted_at AS "submittedAt",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason AS "reviewReason",
          approved_at AS "approvedAt",
          approved_by AS "approvedBy",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM driver_applications
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${dataValues.length - 1}
        OFFSET $${dataValues.length}
      `,
      dataValues,
    );

    return {
      items: result.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }

  async updateStatus(
    id: string,
    review: ReviewDriverApplicationInput,
    reviewerId: string,
  ): Promise<DriverApplication | null> {
    const result = await pool.query<DriverApplication>(
      `
        UPDATE driver_applications
        SET
          status = $1,
          reviewed_at = NOW(),
          reviewed_by = $2,
          review_reason = $3,
          approved_at = CASE
            WHEN $1 = 'APPROVED' THEN NOW()
            ELSE NULL
          END,
          approved_by = CASE
            WHEN $1 = 'APPROVED' THEN $2
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE id = $4
        RETURNING
          id,
          partner_id AS "partnerId",
          driver_profile_id AS "driverProfileId",
          requested_sector AS "requestedSector",
          requested_vehicle_category AS "requestedVehicleCategory",
          vehicle_ownership_type AS "vehicleOwnershipType",
          status,
          submitted_at AS "submittedAt",
          reviewed_at AS "reviewedAt",
          reviewed_by AS "reviewedBy",
          review_reason AS "reviewReason",
          approved_at AS "approvedAt",
          approved_by AS "approvedBy",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [review.status, reviewerId, review.reviewReason ?? null, id],
    );

    return result.rows[0] ?? null;
  }
}
