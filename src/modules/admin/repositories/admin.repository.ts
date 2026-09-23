import type { Pool, QueryResultRow } from 'pg';
import type {
  AdminDashboard,
  AdminFilters,
  AdminPartner,
  AdminUser,
  AdminVehicle,
  CityFleetAnalytics,
  FleetAnalyticsSummary,
  FleetFilters,
  LiveFleetVehicle,
  Page,
  StateFleetAnalytics,
} from '../types/admin.js';

export interface AdminRepository {
  listUsers(filters: AdminFilters): Promise<Page<AdminUser>>;
  getUser(id: string): Promise<AdminUser | null>;
  listPartners(filters: AdminFilters): Promise<Page<AdminPartner>>;
  getPartner(id: string): Promise<AdminPartner | null>;
  listVehicles(filters: AdminFilters): Promise<Page<AdminVehicle>>;
  getVehicle(id: string): Promise<AdminVehicle | null>;
  dashboard(): Promise<AdminDashboard>;
  verifyDriver(driverId: string, status: string, rejectionReason?: string): Promise<boolean>;
  verifyVehicle(vehicleId: string, status: string, rejectionReason?: string): Promise<boolean>;
  verifyDocument(documentId: string, status: string, comments?: string): Promise<boolean>;

  // Fleet Analytics
  getFleetAnalyticsSummary(filters: FleetFilters): Promise<FleetAnalyticsSummary>;
  getStateFleetAnalytics(filters: FleetFilters): Promise<StateFleetAnalytics[]>;
  getCityFleetAnalytics(state: string, filters: FleetFilters): Promise<CityFleetAnalytics[]>;
  getLiveFleetVehicles(filters: FleetFilters): Promise<Page<LiveFleetVehicle>>;
  getLiveFleetVehicleDetails(id: string): Promise<LiveFleetVehicle | null>;
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
      filters.page,
      filters.pageSize,
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
      filters.page,
      filters.pageSize,
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
      filters.page,
      filters.pageSize,
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

  async verifyDriver(
    driverId: string,
    status: string,
    _rejectionReason?: string,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE driver_profiles
       SET verification_status = $1, updated_at = NOW()
       WHERE id = $2 OR user_id = $2
       RETURNING id`,
      [status, driverId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async verifyVehicle(
    vehicleId: string,
    status: string,
    _rejectionReason?: string,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE vehicles
       SET verification_status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [status, vehicleId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async verifyDocument(documentId: string, status: string, comments?: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE partner_documents
       SET status = $1, comments = COALESCE($2, comments), updated_at = NOW()
       WHERE id = $3
       RETURNING id`,
      [status, comments ?? null, documentId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // --- Fleet Analytics Implementation ---

  async getFleetAnalyticsSummary(filters: FleetFilters): Promise<FleetAnalyticsSummary> {
    const { where, values } = fleetWhere(filters);
    const sql = `
      SELECT
        COUNT(*)::int AS "totalVehicles",
        COUNT(*) FILTER (
          WHERE active_ride.id IS NULL
            AND v.is_active = TRUE
            AND dp.availability_status = 'available'
            AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds')
        )::int AS "activeVehicles",
        COUNT(*) FILTER (
          WHERE active_ride.id IS NOT NULL
        )::int AS "onTripVehicles",
        COUNT(*) FILTER (
          WHERE active_ride.id IS NULL
            AND NOT (
              v.is_active = TRUE
              AND dp.availability_status = 'available'
              AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds')
            )
        )::int AS "offlineVehicles"
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
      LEFT JOIN users u ON u.id = dp.user_id
      LEFT JOIN partners pt ON pt.user_id = v.owner_id OR pt.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT r.id
        FROM rides r
        WHERE (r.assigned_vehicle_id = v.id OR r.assigned_driver_id = dp.id)
          AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
        ORDER BY r.created_at DESC
        LIMIT 1
      ) active_ride ON TRUE
      ${where}
    `;

    const res = await this.pool.query<{
      totalVehicles: number;
      activeVehicles: number;
      onTripVehicles: number;
      offlineVehicles: number;
    }>(sql, values);

    const row = res.rows[0] ?? {
      totalVehicles: 0,
      activeVehicles: 0,
      onTripVehicles: 0,
      offlineVehicles: 0,
    };

    const total = row.totalVehicles ?? 0;
    const active = row.activeVehicles ?? 0;
    const activePercentage = total > 0 ? Math.round((active / total) * 1000) / 10 : 0;

    return {
      totalVehicles: total,
      activeVehicles: active,
      onTripVehicles: row.onTripVehicles ?? 0,
      offlineVehicles: row.offlineVehicles ?? 0,
      activePercentage,
    };
  }

  async getStateFleetAnalytics(filters: FleetFilters): Promise<StateFleetAnalytics[]> {
    const { where, values } = fleetWhere(filters);
    const sql = `
      SELECT
        COALESCE(dp.state, pt.state, 'Bihar') AS state,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE active_ride.id IS NULL
            AND v.is_active = TRUE
            AND dp.availability_status = 'available'
            AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds')
        )::int AS active,
        COUNT(*) FILTER (
          WHERE active_ride.id IS NOT NULL
        )::int AS "onTrip",
        COUNT(*) FILTER (
          WHERE active_ride.id IS NULL
            AND NOT (
              v.is_active = TRUE
              AND dp.availability_status = 'available'
              AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds')
            )
        )::int AS offline
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
      LEFT JOIN users u ON u.id = dp.user_id
      LEFT JOIN partners pt ON pt.user_id = v.owner_id OR pt.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT r.id
        FROM rides r
        WHERE (r.assigned_vehicle_id = v.id OR r.assigned_driver_id = dp.id)
          AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
        ORDER BY r.created_at DESC
        LIMIT 1
      ) active_ride ON TRUE
      ${where}
      GROUP BY COALESCE(dp.state, pt.state, 'Bihar')
      ORDER BY total DESC, state ASC
    `;

    const res = await this.pool.query<StateFleetAnalytics>(sql, values);
    return res.rows;
  }

  async getCityFleetAnalytics(state: string, filters: FleetFilters): Promise<CityFleetAnalytics[]> {
    const combinedFilters = { ...filters, state };
    const { where, values } = fleetWhere(combinedFilters);
    const sql = `
      SELECT
        COALESCE(dp.state, pt.state, $1) AS state,
        COALESCE(dp.city, pt.city, 'Patna') AS city,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE active_ride.id IS NULL
            AND v.is_active = TRUE
            AND dp.availability_status = 'available'
            AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds')
        )::int AS active,
        COUNT(*) FILTER (
          WHERE active_ride.id IS NOT NULL
        )::int AS "onTrip",
        COUNT(*) FILTER (
          WHERE active_ride.id IS NULL
            AND NOT (
              v.is_active = TRUE
              AND dp.availability_status = 'available'
              AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds')
            )
        )::int AS offline
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
      LEFT JOIN users u ON u.id = dp.user_id
      LEFT JOIN partners pt ON pt.user_id = v.owner_id OR pt.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT r.id
        FROM rides r
        WHERE (r.assigned_vehicle_id = v.id OR r.assigned_driver_id = dp.id)
          AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
        ORDER BY r.created_at DESC
        LIMIT 1
      ) active_ride ON TRUE
      ${where}
      GROUP BY COALESCE(dp.state, pt.state, $1), COALESCE(dp.city, pt.city, 'Patna')
      ORDER BY total DESC, city ASC
    `;

    const res = await this.pool.query<CityFleetAnalytics>(sql, values);
    return res.rows;
  }

  async getLiveFleetVehicles(filters: FleetFilters): Promise<Page<LiveFleetVehicle>> {
    const { where, values } = fleetWhere(filters);
    const dataSql = `
      SELECT
        v.id,
        v.plate_number AS "plateNumber",
        v.make,
        v.model,
        v.color,
        COALESCE(v.sector, 'passenger') AS sector,
        COALESCE(v.category, 'sedan') AS category,
        CASE
          WHEN active_ride.id IS NOT NULL THEN 'on_trip'
          WHEN v.is_active = TRUE AND dp.availability_status = 'available' AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds') THEN 'active'
          ELSE 'offline'
        END AS status,
        dp.id AS "driverId",
        CASE WHEN u.id IS NOT NULL THEN (u.first_name || ' ' || u.last_name) ELSE NULL END AS "driverName",
        u.phone AS "driverPhone",
        COALESCE(dp.state, pt.state, 'Bihar') AS state,
        COALESCE(dp.city, pt.city, 'Patna') AS city,
        ST_Y(dp.last_location::geometry) AS latitude,
        ST_X(dp.last_location::geometry) AS longitude,
        dp.last_location_at::text AS "lastLocationAt",
        active_ride.id AS "currentRideId",
        COALESCE(v.verification_status, 'approved') AS "verificationStatus",
        v.created_at::text AS "createdAt"
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
      LEFT JOIN users u ON u.id = dp.user_id
      LEFT JOIN partners pt ON pt.user_id = v.owner_id OR pt.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT r.id
        FROM rides r
        WHERE (r.assigned_vehicle_id = v.id OR r.assigned_driver_id = dp.id)
          AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
        ORDER BY r.created_at DESC
        LIMIT 1
      ) active_ride ON TRUE
      ${where}
      ORDER BY v.created_at DESC
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
      LEFT JOIN users u ON u.id = dp.user_id
      LEFT JOIN partners pt ON pt.user_id = v.owner_id OR pt.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT r.id
        FROM rides r
        WHERE (r.assigned_vehicle_id = v.id OR r.assigned_driver_id = dp.id)
          AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
        ORDER BY r.created_at DESC
        LIMIT 1
      ) active_ride ON TRUE
      ${where}
    `;

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;

    return this.paginate<LiveFleetVehicle>(dataSql, countSql, values, page, pageSize);
  }

  async getLiveFleetVehicleDetails(id: string): Promise<LiveFleetVehicle | null> {
    const sql = `
      SELECT
        v.id,
        v.plate_number AS "plateNumber",
        v.make,
        v.model,
        v.color,
        COALESCE(v.sector, 'passenger') AS sector,
        COALESCE(v.category, 'sedan') AS category,
        CASE
          WHEN active_ride.id IS NOT NULL THEN 'on_trip'
          WHEN v.is_active = TRUE AND dp.availability_status = 'available' AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds') THEN 'active'
          ELSE 'offline'
        END AS status,
        dp.id AS "driverId",
        CASE WHEN u.id IS NOT NULL THEN (u.first_name || ' ' || u.last_name) ELSE NULL END AS "driverName",
        u.phone AS "driverPhone",
        COALESCE(dp.state, pt.state, 'Bihar') AS state,
        COALESCE(dp.city, pt.city, 'Patna') AS city,
        ST_Y(dp.last_location::geometry) AS latitude,
        ST_X(dp.last_location::geometry) AS longitude,
        dp.last_location_at::text AS "lastLocationAt",
        active_ride.id AS "currentRideId",
        COALESCE(v.verification_status, 'approved') AS "verificationStatus",
        v.created_at::text AS "createdAt"
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.id = v.driver_profile_id
      LEFT JOIN users u ON u.id = dp.user_id
      LEFT JOIN partners pt ON pt.user_id = v.owner_id OR pt.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT r.id
        FROM rides r
        WHERE (r.assigned_vehicle_id = v.id OR r.assigned_driver_id = dp.id)
          AND r.status IN ('driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress')
        ORDER BY r.created_at DESC
        LIMIT 1
      ) active_ride ON TRUE
      WHERE v.id = $1
    `;

    const res = await this.pool.query<LiveFleetVehicle>(sql, [id]);
    return res.rows[0] ?? null;
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
    page: number,
    pageSize: number,
  ): Promise<Page<T>> {
    const offset = (page - 1) * pageSize;
    const [data, count] = await Promise.all([
      this.pool.query<T>(`${dataSql} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [
        ...values,
        pageSize,
        offset,
      ]),
      this.pool.query<{ count: number }>(countSql, values),
    ]);
    return {
      items: data.rows,
      page,
      pageSize,
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

function fleetWhere(filters: FleetFilters) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.state) {
    values.push(filters.state);
    conditions.push(`COALESCE(dp.state, pt.state, 'Bihar') ILIKE $${values.length}`);
  }
  if (filters.city) {
    values.push(filters.city);
    conditions.push(`COALESCE(dp.city, pt.city, 'Patna') ILIKE $${values.length}`);
  }
  if (filters.sector) {
    values.push(filters.sector);
    conditions.push(`COALESCE(v.sector, 'passenger') = $${values.length}`);
  }
  if (filters.category) {
    values.push(filters.category);
    conditions.push(`COALESCE(v.category, 'sedan') ILIKE $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(v.plate_number ILIKE $${values.length} OR v.make ILIKE $${values.length} OR v.model ILIKE $${values.length} OR u.first_name ILIKE $${values.length} OR u.last_name ILIKE $${values.length} OR u.phone ILIKE $${values.length})`,
    );
  }
  if (filters.status && filters.status !== 'all') {
    if (filters.status === 'on_trip') {
      conditions.push(`active_ride.id IS NOT NULL`);
    } else if (filters.status === 'active') {
      conditions.push(
        `active_ride.id IS NULL AND v.is_active = TRUE AND dp.availability_status = 'available' AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds')`,
      );
    } else if (filters.status === 'offline') {
      conditions.push(
        `active_ride.id IS NULL AND NOT (v.is_active = TRUE AND dp.availability_status = 'available' AND dp.last_location_at >= (NOW() - INTERVAL '30 seconds'))`,
      );
    }
  }

  return {
    where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
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
