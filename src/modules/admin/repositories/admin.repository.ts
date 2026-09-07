import type { Pool, QueryResultRow } from 'pg';
import type {
  AdminDashboard,
  AdminFilters,
  AdminPartner,
  AdminUser,
  AdminVehicle,
  Page,
} from '../types/admin.js';

export interface AdminRepository {
  listUsers(filters: AdminFilters): Promise<Page<AdminUser>>;
  getUser(id: string): Promise<AdminUser | null>;
  listPartners(filters: AdminFilters): Promise<Page<AdminPartner>>;
  getPartner(id: string): Promise<AdminPartner | null>;
  listVehicles(filters: AdminFilters): Promise<Page<AdminVehicle>>;
  getVehicle(id: string): Promise<AdminVehicle | null>;
  dashboard(): Promise<AdminDashboard>;
}

const userProjection = `
  id, first_name AS "firstName", last_name AS "lastName", email, phone,
  role, status, created_at AS "createdAt"`;

const partnerProjection = `
  p.id, p.user_id AS "userId", p.business_name AS "businessName",
  p.business_description AS "businessDescription", p.approval_status AS "approvalStatus",
  p.availability_status AS "availabilityStatus", p.created_at AS "createdAt",
  p.updated_at AS "updatedAt",
  COALESCE((SELECT pd.status::text FROM partner_documents pd
            WHERE pd.partner_id = p.id AND pd.vehicle_id IS NULL
            ORDER BY CASE WHEN pd.status = 'REJECTED' THEN 0 WHEN pd.status = 'PENDING' THEN 1 ELSE 2 END,
                     pd.updated_at DESC LIMIT 1), 'PENDING') AS "kycStatus",
  ${partnerDocumentStatusProjection('AADHAAR', 'aadhaarStatus')},
  ${partnerDocumentStatusProjection('PAN', 'panStatus')},
  ${partnerDocumentStatusProjection('DRIVING_LICENCE', 'drivingLicenceStatus')},
  ${partnerDocumentStatusProjection('PROFILE_PHOTO', 'profilePhotoStatus')},
  ${partnerDocumentStatusProjection('ADDRESS_PROOF', 'addressProofStatus')},
  (SELECT COUNT(*)::int FROM vehicles v JOIN driver_profiles d ON d.id = v.driver_profile_id
   WHERE d.user_id = p.user_id) AS "vehicleCount",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', v.id, 'plateNumber', v.plate_number, 'isActive', v.is_active,
    'insuranceStatus', (SELECT pd.status::text FROM partner_documents pd WHERE pd.vehicle_id = v.id AND pd.document_type = 'VEHICLE_INSURANCE' ORDER BY pd.updated_at DESC LIMIT 1),
    'permitStatus', (SELECT pd.status::text FROM partner_documents pd WHERE pd.vehicle_id = v.id AND pd.document_type = 'VEHICLE_PERMIT' ORDER BY pd.updated_at DESC LIMIT 1),
    'fitnessStatus', (SELECT pd.status::text FROM partner_documents pd WHERE pd.vehicle_id = v.id AND pd.document_type = 'VEHICLE_FITNESS' ORDER BY pd.updated_at DESC LIMIT 1)
  ) ORDER BY v.created_at DESC)
  FROM vehicles v JOIN driver_profiles d ON d.id = v.driver_profile_id
  WHERE d.user_id = p.user_id), '[]'::jsonb) AS "vehicles"`;

const vehicleProjection = `
  v.id, v.driver_profile_id AS "driverProfileId", p.id AS "partnerId", v.make, v.model,
  v.plate_number AS "plateNumber", v.is_active AS "isActive", v.created_at AS "createdAt",
  v.updated_at AS "updatedAt",
  (SELECT pd.status::text FROM partner_documents pd WHERE pd.vehicle_id = v.id
   AND pd.document_type = 'VEHICLE_INSURANCE' ORDER BY pd.updated_at DESC LIMIT 1) AS "insuranceStatus",
  (SELECT pd.status::text FROM partner_documents pd WHERE pd.vehicle_id = v.id
   AND pd.document_type = 'VEHICLE_PERMIT' ORDER BY pd.updated_at DESC LIMIT 1) AS "permitStatus",
  (SELECT pd.status::text FROM partner_documents pd WHERE pd.vehicle_id = v.id
   AND pd.document_type = 'VEHICLE_FITNESS' ORDER BY pd.updated_at DESC LIMIT 1) AS "fitnessStatus"`;

export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly pool: Pool) {}

  async listUsers(filters: AdminFilters): Promise<Page<AdminUser>> {
    const { where, values } = userWhere(filters);
    return this.paginate<AdminUser>(
      `SELECT ${userProjection} FROM users${where} ORDER BY created_at DESC`,
      `SELECT COUNT(*)::int AS count FROM users${where}`,
      values,
      filters,
    );
  }

  async getUser(id: string): Promise<AdminUser | null> {
    const result = await this.pool.query<AdminUser>(
      `SELECT ${userProjection} FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listPartners(filters: AdminFilters): Promise<Page<AdminPartner>> {
    const { where, values } = partnerWhere(filters);
    return this.paginate<AdminPartner>(
      `SELECT ${partnerProjection} FROM partners p${where} ORDER BY p.created_at DESC`,
      `SELECT COUNT(*)::int AS count FROM partners p${where}`,
      values,
      filters,
    );
  }

  async getPartner(id: string): Promise<AdminPartner | null> {
    const result = await this.pool.query<AdminPartner>(
      `SELECT ${partnerProjection} FROM partners p WHERE p.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listVehicles(filters: AdminFilters): Promise<Page<AdminVehicle>> {
    const { where, values } = vehicleWhere(filters);
    return this.paginate<AdminVehicle>(
      `SELECT ${vehicleProjection} FROM vehicles v
       LEFT JOIN driver_profiles d ON d.id = v.driver_profile_id
       LEFT JOIN partners p ON p.user_id = d.user_id${where}
       ORDER BY v.created_at DESC`,
      `SELECT COUNT(*)::int AS count FROM vehicles v
       LEFT JOIN driver_profiles d ON d.id = v.driver_profile_id
       LEFT JOIN partners p ON p.user_id = d.user_id${where}`,
      values,
      filters,
    );
  }

  async getVehicle(id: string): Promise<AdminVehicle | null> {
    const result = await this.pool.query<AdminVehicle>(
      `SELECT ${vehicleProjection} FROM vehicles v
       LEFT JOIN driver_profiles d ON d.id = v.driver_profile_id
       LEFT JOIN partners p ON p.user_id = d.user_id
       WHERE v.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async dashboard(): Promise<AdminDashboard> {
    const [users, partners, vehicles, kyc, insurance, permits, fitness] = await Promise.all([
      this.pool.query<{ total: number; active: number; suspended: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended FROM users`,
      ),
      this.pool.query<{ total: number; approved: number; pending: number; active: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE approval_status = 'approved')::int AS approved,
                COUNT(*) FILTER (WHERE approval_status IN ('pending', 'under_review'))::int AS pending,
                COUNT(*) FILTER (WHERE availability_status = 'available')::int AS active FROM partners`,
      ),
      this.pool.query<{ total: number; active: number }>(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM vehicles`,
      ),
      this.pool.query<{ pending: number; verified: number; rejected: number; expired: number }>(
        `SELECT COUNT(*) FILTER (WHERE status IN ('PENDING', 'SUBMITTED'))::int AS pending,
                COUNT(*) FILTER (WHERE status = 'VERIFIED')::int AS verified,
                COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
                COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired
         FROM partner_documents`,
      ),
      this.complianceCount('VEHICLE_INSURANCE'),
      this.complianceCount('VEHICLE_PERMIT'),
      this.complianceCount('VEHICLE_FITNESS'),
    ]);
    return {
      users: users.rows[0] ?? { total: 0, active: 0, suspended: 0 },
      partners: partners.rows[0] ?? { total: 0, approved: 0, pending: 0, active: 0 },
      vehicles: vehicles.rows[0] ?? { total: 0, active: 0 },
      kyc: kyc.rows[0] ?? { pending: 0, verified: 0, rejected: 0, expired: 0 },
      vehicleCompliance: {
        insuranceExpiringOrExpired: insurance,
        permitsExpiringOrExpired: permits,
        fitnessExpiringOrExpired: fitness,
      },
    };
  }

  private async complianceCount(type: string): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM partner_documents
       WHERE document_type = $1 AND expires_at IS NOT NULL
         AND expires_at <= CURRENT_DATE + INTERVAL '30 days'`,
      [type],
    );
    return result.rows[0]?.count ?? 0;
  }

  private async paginate<T extends QueryResultRow>(
    dataSql: string,
    countSql: string,
    values: unknown[],
    filters: AdminFilters,
  ): Promise<Page<T>> {
    const offset = (filters.page - 1) * filters.pageSize;
    const [data, count] = await Promise.all([
      this.pool.query<T>(`${dataSql} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [
        ...values,
        filters.pageSize,
        offset,
      ]),
      this.pool.query<{ count: number }>(countSql, values),
    ]);
    return {
      items: data.rows,
      page: filters.page,
      pageSize: filters.pageSize,
      total: count.rows[0]?.count ?? 0,
    };
  }
}

function userWhere(filters: AdminFilters) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(first_name ILIKE $${values.length} OR last_name ILIKE $${values.length} OR email ILIKE $${values.length} OR phone ILIKE $${values.length})`,
    );
  }
  if (filters.role) {
    values.push(filters.role);
    conditions.push(`role = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }
  addDates(conditions, values, 'created_at', filters);
  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', values };
}

function partnerWhere(filters: AdminFilters) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(p.business_name ILIKE $${values.length} OR p.business_description ILIKE $${values.length})`,
    );
  }
  if (filters.approvalStatus) {
    values.push(filters.approvalStatus);
    conditions.push(`p.approval_status = $${values.length}`);
  }
  if (filters.availabilityStatus) {
    values.push(filters.availabilityStatus);
    conditions.push(`p.availability_status = $${values.length}`);
  }
  if (filters.documentStatus) {
    values.push(filters.documentStatus);
    conditions.push(
      `EXISTS (SELECT 1 FROM partner_documents pd WHERE pd.partner_id = p.id
        AND pd.vehicle_id IS NULL AND pd.status = $${values.length}::partner_document_status)`,
    );
  }
  if (filters.complianceStatus) {
    conditions.push(partnerCompliancePredicate(filters.complianceStatus));
  }
  addDates(conditions, values, 'p.created_at', filters);
  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', values };
}

function vehicleWhere(filters: AdminFilters) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.partnerId) {
    values.push(filters.partnerId);
    conditions.push(`p.id = $${values.length}`);
  }
  if (filters.active !== undefined) {
    values.push(filters.active);
    conditions.push(`v.is_active = $${values.length}`);
  }
  if (filters.plate) {
    values.push(`%${filters.plate}%`);
    conditions.push(`v.plate_number ILIKE $${values.length}`);
  }
  if (filters.make) {
    values.push(`%${filters.make}%`);
    conditions.push(`v.make ILIKE $${values.length}`);
  }
  if (filters.model) {
    values.push(`%${filters.model}%`);
    conditions.push(`v.model ILIKE $${values.length}`);
  }
  if (filters.documentStatus) {
    values.push(filters.documentStatus);
    conditions.push(
      `EXISTS (SELECT 1 FROM partner_documents pd WHERE pd.vehicle_id = v.id
        AND pd.status = $${values.length}::partner_document_status)`,
    );
  }
  if (filters.complianceStatus) {
    conditions.push(vehicleCompliancePredicate(filters.complianceStatus));
  }
  addDates(conditions, values, 'v.created_at', filters);
  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', values };
}

function partnerDocumentStatusProjection(documentType: string, alias: string) {
  return `COALESCE((SELECT pd.status::text FROM partner_documents pd
    WHERE pd.partner_id = p.id AND pd.vehicle_id IS NULL
      AND pd.document_type = '${documentType}'
    ORDER BY pd.updated_at DESC LIMIT 1), 'PENDING') AS "${alias}"`;
}

function vehicleCompliancePredicate(status: NonNullable<AdminFilters['complianceStatus']>) {
  const required = `('VEHICLE_RC'::partner_document_type), ('VEHICLE_INSURANCE'::partner_document_type),
    ('VEHICLE_PERMIT'::partner_document_type), ('VEHICLE_FITNESS'::partner_document_type)`;
  if (status === 'compliant') {
    return `NOT EXISTS (SELECT 1 FROM (VALUES ${required}) AS required(document_type)
      WHERE NOT EXISTS (SELECT 1 FROM partner_documents pd
        WHERE pd.vehicle_id = v.id AND pd.document_type = required.document_type
          AND pd.status = 'VERIFIED'
          AND (pd.expires_at IS NULL OR pd.expires_at >= CURRENT_DATE)))`;
  }
  if (status === 'non_compliant') {
    return `EXISTS (SELECT 1 FROM (VALUES ${required}) AS required(document_type)
      WHERE NOT EXISTS (SELECT 1 FROM partner_documents pd
        WHERE pd.vehicle_id = v.id AND pd.document_type = required.document_type
          AND pd.status = 'VERIFIED'
          AND (pd.expires_at IS NULL OR pd.expires_at >= CURRENT_DATE)))`;
  }
  if (status === 'expiring') {
    return `EXISTS (SELECT 1 FROM partner_documents pd WHERE pd.vehicle_id = v.id
      AND pd.status = 'VERIFIED' AND pd.expires_at > CURRENT_DATE
      AND pd.expires_at <= CURRENT_DATE + INTERVAL '30 days')`;
  }
  return `EXISTS (SELECT 1 FROM partner_documents pd WHERE pd.vehicle_id = v.id
    AND (pd.status = 'EXPIRED' OR pd.expires_at < CURRENT_DATE))`;
}

function partnerCompliancePredicate(status: NonNullable<AdminFilters['complianceStatus']>) {
  return `EXISTS (SELECT 1 FROM vehicles v
    JOIN driver_profiles d ON d.id = v.driver_profile_id
    WHERE d.user_id = p.user_id AND ${vehicleCompliancePredicate(status)})`;
}

function addDates(conditions: string[], values: unknown[], column: string, filters: AdminFilters) {
  if (filters.from) {
    values.push(filters.from);
    conditions.push(`${column} >= $${values.length}::date`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`${column} < ($${values.length}::date + INTERVAL '1 day')`);
  }
}
