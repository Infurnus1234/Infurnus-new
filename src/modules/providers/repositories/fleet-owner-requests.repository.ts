import type { Pool, PoolClient } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import { PostgresDriverApplicationRepository } from '../../driver-applications/driver-application.repository.js';
import { PostgresDriverDocumentRepository } from '../../rides/repositories/driver-document.repository.js';
import type { PostgresProviderOperationsRepository } from './provider-operations.repository.js';

export const fleetRequestCategories = [
  'fleet',
  'vehicle',
  'driver',
  'association',
  'other',
] as const;
type Category = (typeof fleetRequestCategories)[number];
type Source = 'approval' | 'application';
type Selection = { id: string; source: Source; expectedUpdatedAt: string };
type Decision = 'APPROVED' | 'REJECTED';
type RequestRow = {
  id: string;
  source: Source;
  category: Category;
  request_type: string;
  target_type: string;
  target_id: string;
  status: string;
  can_review: boolean;
  expected_updated_at: string | null;
  target_description: string | null;
  submitted_at: Date;
  rejection_reason: string | null;
};

const ownerAccounts = `
  SELECT p.id, p.user_id, provider_public_id(u.id) AS public_id,
    COALESCE(provider_public_id(u.id), p.id::text) AS owner_key,
    COALESCE(NULLIF(btrim(concat_ws(' ',u.first_name,u.last_name)),''),p.owner_name,p.business_name) AS name,
    p.business_name, p.business_type, p.city, p.state, u.email, u.phone,
    u.status AS account_status, u.email_verified, u.phone_verified, p.approval_status, p.created_at
  FROM partners p JOIN users u ON u.id=p.user_id
  WHERE u.deleted_at IS NULL AND u.role IN ('fleet_owner','driver_fleet_owner')`;

// An explicit fleet is provenance for driver submissions. For legacy rows with
// no provenance, only a unique, recorded relationship may supply the owner.
const scopedRequests = `
WITH accounts AS MATERIALIZED (${ownerAccounts}),
owner_fleets AS MATERIALIZED (SELECT id,user_id FROM accounts WHERE owner_key=$1),
requests AS MATERIALIZED (
  SELECT r.id,'approval'::text AS source,r.target_type::text,r.target_id,r.request_type::text,
    CASE
      WHEN r.request_type='driver_association' THEN 'association'
      WHEN r.target_type='vehicle' OR (r.target_type='partner_document' AND pd.vehicle_id IS NOT NULL) THEN 'vehicle'
      WHEN r.target_type IN ('driver_profile','driver_document') THEN 'driver'
      WHEN r.target_type IN ('partner','partner_document') THEN 'fleet'
      ELSE 'other'
    END AS category,
    r.status::text,r.submitted_at,r.rejection_reason,
    COALESCE(v.plate_number,doc_vehicle.plate_number,
      NULLIF(btrim(concat_ws(' ',driver_user.first_name,driver_user.last_name)),''),
      pd.document_type::text,dd.document_type::text,target_partner.business_name) AS target_description,
    version.stamp AS expected_updated_at,
    (r.status='PENDING' AND r.requester_id<>$3 AND version.stamp IS NOT NULL
      AND owner.user_id<>$3 AND dp.user_id IS DISTINCT FROM $3
      AND (r.request_type<>'driver_association' OR r.fleet_id IS NOT NULL)) AS can_review
  FROM provider_approval_requests r
  LEFT JOIN vehicles v ON r.target_type='vehicle' AND v.id=r.target_id
  LEFT JOIN partners vehicle_owner ON vehicle_owner.user_id=v.owner_id
  LEFT JOIN partners target_partner ON r.target_type='partner' AND target_partner.id=r.target_id
  LEFT JOIN partner_documents pd ON r.target_type='partner_document' AND pd.id=r.target_id
  LEFT JOIN vehicles doc_vehicle ON doc_vehicle.id=pd.vehicle_id
  LEFT JOIN partners doc_vehicle_owner ON doc_vehicle_owner.user_id=doc_vehicle.owner_id
  LEFT JOIN provider_bank_accounts b ON r.target_type='bank_account' AND b.id=r.target_id
  LEFT JOIN partners bank_owner ON bank_owner.user_id=b.user_id
  LEFT JOIN driver_documents dd ON r.target_type='driver_document' AND dd.id=r.target_id
  LEFT JOIN driver_profiles dp ON dp.id=CASE r.target_type
    WHEN 'driver_profile' THEN r.target_id WHEN 'driver_document' THEN dd.driver_profile_id END
  LEFT JOIN users driver_user ON driver_user.id=dp.user_id AND driver_user.deleted_at IS NULL
  LEFT JOIN accounts driver_owner ON driver_owner.user_id=dp.user_id
  LEFT JOIN LATERAL (
    SELECT (array_agg(link.partner_id))[1] AS partner_id
    FROM (
      SELECT m.partner_id FROM fleet_managed_driver_accounts m
        WHERE m.driver_user_id=dp.user_id AND m.status='ACTIVE'
      UNION
      SELECT pd_link.partner_id FROM partner_drivers pd_link
        WHERE pd_link.driver_profile_id=dp.id AND pd_link.status='ACTIVE'
      UNION
      SELECT i.partner_id FROM driver_onboarding_invitations i
        WHERE i.driver_user_id=dp.user_id AND i.status='CONSUMED' AND i.consumed_at IS NOT NULL
    ) link HAVING count(*)=1
  ) relationship ON r.fleet_id IS NULL AND dp.id IS NOT NULL AND driver_owner.id IS NULL
  JOIN owner_fleets owner ON owner.id=CASE r.target_type
    WHEN 'vehicle' THEN CASE WHEN v.id IS NULL THEN r.fleet_id ELSE vehicle_owner.id END
    WHEN 'partner' THEN COALESCE(target_partner.id,r.fleet_id)
    WHEN 'partner_document' THEN CASE WHEN pd.vehicle_id IS NOT NULL THEN doc_vehicle_owner.id
      ELSE COALESCE(pd.partner_id,r.fleet_id) END
    WHEN 'bank_account' THEN CASE WHEN b.id IS NULL THEN r.fleet_id ELSE bank_owner.id END
    ELSE COALESCE(r.fleet_id,driver_owner.id,relationship.partner_id)
  END
  CROSS JOIN LATERAL (SELECT to_jsonb(CASE r.target_type
    WHEN 'driver_profile' THEN dp.updated_at WHEN 'driver_document' THEN dd.updated_at
    WHEN 'vehicle' THEN v.updated_at WHEN 'partner' THEN target_partner.updated_at
    WHEN 'partner_document' THEN pd.updated_at WHEN 'bank_account' THEN b.updated_at
  END)#>>'{}' AS stamp) version
  WHERE r.admin_deleted_at IS NULL AND ($2::uuid[] IS NULL OR r.id=ANY($2))
  UNION ALL
  SELECT a.id,'application','driver_profile',a.driver_profile_id,'fleet_membership_application',
    'association',a.status::text,COALESCE(a.submitted_at,a.created_at),a.review_reason,
    concat_ws(' · ',NULLIF(btrim(concat_ws(' ',u.first_name,u.last_name)),''),
      a.requested_sector,a.requested_vehicle_category,a.vehicle_ownership_type),
    to_jsonb(a.updated_at)#>>'{}',
    (a.status IN ('PENDING','UNDER_REVIEW','CHANGES_REQUESTED') AND owner.user_id<>$3 AND dp.user_id<>$3)
  FROM driver_applications a JOIN owner_fleets owner ON owner.id=a.partner_id
  JOIN driver_profiles dp ON dp.id=a.driver_profile_id
  JOIN users u ON u.id=dp.user_id AND u.deleted_at IS NULL
  WHERE a.admin_deleted_at IS NULL AND ($2::uuid[] IS NULL OR a.id=ANY($2))
)`;

const pending = "status IN ('PENDING','UNDER_REVIEW','CHANGES_REQUESTED')";
const unavailable = () =>
  new AppError('FLEET_REQUEST_NOT_FOUND', 'Request is not in this Fleet Owner workspace', 404);

function dependencyOrder(row?: RequestRow) {
  if (row?.target_type.endsWith('_document')) return 0;
  if (row?.target_type === 'partner') return 1;
  return row?.category === 'association' ? 3 : 2;
}

export class FleetOwnerRequestsRepository {
  constructor(
    private readonly pool: Pool,
    private readonly approvals: PostgresProviderOperationsRepository,
  ) {}

  async owners(actor: string, search: string, limit: number, offset: number) {
    const client = await this.pool.connect();
    try {
      await this.approvals.authorizeReviewer(client, actor);
      const { rows } = await client.query(
        `WITH accounts AS (${ownerAccounts}),
         owners AS (SELECT DISTINCT ON (owner_key)
           owner_key, public_id, name, business_name, approval_status
           FROM accounts WHERE concat_ws(' ',owner_key,name,business_name) ILIKE '%'||$1||'%'
           ORDER BY owner_key,created_at,id)
         SELECT * FROM owners ORDER BY name,owner_key LIMIT $2 OFFSET $3`,
        [search, limit + 1, offset],
      );
      return { items: rows.slice(0, limit), hasNext: rows.length > limit };
    } finally {
      client.release();
    }
  }

  async requests(
    actor: string,
    owner: string,
    options: {
      category: Category | 'all';
      status: string;
      limit: number;
      offset: number;
      selectable: boolean;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await this.approvals.authorizeReviewer(client, actor);
      const { rows } = await client.query(
        `${scopedRequests},
         profile AS (SELECT public_id, name, business_name,business_type,city,state,email,phone,email_verified,phone_verified,
           account_status,approval_status FROM accounts WHERE owner_key=$1 ORDER BY created_at,id LIMIT 1),
         page AS (SELECT * FROM requests WHERE ($4='all' OR category=$4)
           AND ($5='ALL' OR status=$5 OR ($5='PENDING' AND ${pending}))
           AND (NOT $8::boolean OR can_review)
           ORDER BY submitted_at DESC,id DESC,source LIMIT $6 OFFSET $7)
         SELECT (SELECT to_jsonb(profile) FROM profile) AS owner,
           (SELECT count(*)::int FROM vehicles v JOIN owner_fleets f ON f.user_id=v.owner_id
             WHERE NOT EXISTS (SELECT 1 FROM user_history h WHERE h.event_type='ADMIN_RECORD_DELETED'
               AND h.entity_id=v.id AND h.metadata->>'module'='vehicles')) AS vehicle_count,
           (SELECT count(*)::int FROM (
             SELECT dp.user_id FROM partner_drivers pd JOIN owner_fleets f ON f.id=pd.partner_id
             JOIN driver_profiles dp ON dp.id=pd.driver_profile_id WHERE pd.status='ACTIVE'
             UNION SELECT m.driver_user_id FROM fleet_managed_driver_accounts m
               JOIN owner_fleets f ON f.id=m.partner_id WHERE m.status='ACTIVE'
           ) related JOIN users u ON u.id=related.user_id AND u.deleted_at IS NULL) AS driver_count,
           (SELECT jsonb_build_object('pending',count(*) FILTER(WHERE ${pending}),
             'approved',count(*) FILTER(WHERE status='APPROVED'),
             'rejected',count(*) FILTER(WHERE status='REJECTED'),'total',count(*)) FROM requests) AS counts,
           (SELECT COALESCE(jsonb_agg(page ORDER BY submitted_at DESC,id DESC,source),'[]') FROM page) AS items`,
        [
          owner,
          null,
          actor,
          options.category,
          options.status,
          options.limit + 1,
          options.offset,
          options.selectable,
        ],
      );
      const result = rows[0];
      if (!result.owner) throw new AppError('PARTNER_NOT_FOUND', 'Fleet Owner not found', 404);
      return {
        ...result,
        items: result.items.slice(0, options.limit),
        hasNext: result.items.length > options.limit,
      };
    } finally {
      client.release();
    }
  }

  private async scoped(client: PoolClient | Pool, owner: string, actor: string, ids: string[]) {
    return (
      await client.query<RequestRow>(`${scopedRequests} SELECT * FROM requests`, [
        owner,
        ids,
        actor,
      ])
    ).rows;
  }

  private async applicationProfile(actor: string, id: string) {
    const client = await this.pool.connect();
    try {
      await this.approvals.authorizeReviewer(client, actor);
      const { rows } = await client.query<{ driver_profile_id: string }>(
        `WITH accounts AS (${ownerAccounts})
         SELECT a.driver_profile_id FROM driver_applications a JOIN accounts owner ON owner.id=a.partner_id
         JOIN driver_profiles dp ON dp.id=a.driver_profile_id JOIN users u ON u.id=dp.user_id
         WHERE a.id=$1 AND a.admin_deleted_at IS NULL AND u.deleted_at IS NULL`,
        [id],
      );
      if (!rows[0]) throw unavailable();
      return rows[0].driver_profile_id;
    } finally {
      client.release();
    }
  }

  async applicationEvidence(actor: string, id: string) {
    const profile = await this.applicationProfile(actor, id);
    const repository = new PostgresDriverDocumentRepository(this.pool);
    const documents = await repository.listByDriver(profile);
    return {
      documents: await Promise.all(
        documents.map(async (doc) => ({
          id: doc.id,
          documentType: doc.documentType,
          status: doc.verificationStatus,
          mimeType: doc.mimeType,
          createdAt: doc.createdAt,
          reviewedAt: doc.verifiedAt,
          reason: doc.rejectionReason,
          pages: (await repository.currentPages(profile, doc.id)).map((page, index) => ({
            pageNumber: index + 1,
            side: page.side,
            mimeType: page.mimeType,
          })),
        })),
      ),
    };
  }

  async applicationDocument(actor: string, id: string, documentId: string, page?: number) {
    const profile = await this.applicationProfile(actor, id);
    const repository = new PostgresDriverDocumentRepository(this.pool);
    const doc = await repository.findById(documentId);
    if (doc?.driverProfileId !== profile)
      throw new AppError('DOCUMENT_NOT_FOUND', 'Document is not related to this application', 404);
    const asset =
      page === undefined ? doc : (await repository.currentPages(profile, documentId))[page - 1];
    if (!asset) throw new AppError('DOCUMENT_NOT_FOUND', 'Page not found', 404);
    return {
      storageKey: asset.storageKey,
      resourceType: asset.resourceType,
      accessMode: 'authenticated' as const,
    };
  }

  async review(
    actor: string,
    owner: string,
    status: Decision,
    reason: string | undefined,
    items: Selection[],
  ) {
    const reviewer = await this.pool.connect();
    try {
      await this.approvals.authorizeReviewer(reviewer, actor);
    } finally {
      reviewer.release();
    }
    const current = await this.scoped(
      this.pool,
      owner,
      actor,
      items.map(({ id }) => id),
    );
    const byId = new Map(current.map((row) => [row.source + row.id, row]));
    const ordered = [...items].sort(
      (a, b) =>
        dependencyOrder(byId.get(a.source + a.id)) - dependencyOrder(byId.get(b.source + b.id)),
    );
    const results = [];
    for (const item of ordered) {
      try {
        const outcome = await this.reviewOne(actor, owner, status, reason, item);
        results.push({ id: item.id, source: item.source, outcome, status });
      } catch (error) {
        // A concurrent decision may have won after the first scope read.
        if (error instanceof AppError && error.code === 'APPROVAL_ALREADY_REVIEWED') {
          const [latest] = (await this.scoped(this.pool, owner, actor, [item.id])).filter(
            (row) => row.source === item.source,
          );
          if (latest?.status === status) {
            results.push({ id: item.id, source: item.source, outcome: 'unchanged', status });
            continue;
          }
        }
        results.push({
          id: item.id,
          source: item.source,
          outcome: 'failed',
          code: error instanceof AppError ? error.code : 'REVIEW_FAILED',
          message:
            error instanceof AppError
              ? error.message
              : 'The decision could not be saved. Refresh and try again.',
        });
      }
    }
    return results;
  }

  private async reviewOne(
    actor: string,
    owner: string,
    status: Decision,
    reason: string | undefined,
    item: Selection,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.approvals.authorizeReviewer(client, actor);
      if (item.source === 'application')
        await client.query('SELECT id FROM driver_applications WHERE id=$1 FOR UPDATE', [item.id]);
      const find = async () => {
        const row = (await this.scoped(client, owner, actor, [item.id])).find(
          (row) => row.source === item.source,
        );
        if (!row) throw unavailable();
        return row;
      };
      const row = await find();
      if (row.status === status) {
        await client.query('COMMIT');
        return 'unchanged';
      }
      if (!row.can_review)
        throw new AppError(
          'REQUEST_NOT_REVIEWABLE',
          'This request is no longer eligible for review',
          409,
        );
      if (item.source === 'approval') {
        await this.approvals.reviewApproval(
          actor,
          item.id,
          {
            status,
            reason,
            expectedUpdatedAt: item.expectedUpdatedAt,
          },
          client,
          async () => {
            if (!(await find()).can_review)
              throw new AppError(
                'REQUEST_NOT_REVIEWABLE',
                'This request is no longer eligible for review',
                409,
              );
          },
        );
      } else {
        const {
          rows: [application],
        } = await client.query(
          `SELECT a.updated_at=$2::timestamptz AS matches,
            CASE WHEN $3::boolean THEN
              provider_compliance_satisfied(dp.user_id,dp.id,NULL,dp.active_vehicle_id,a.requested_vehicle_category)
            ELSE true END AS compliant,
            (p.approval_status='approved' AND dp.license_expiry>=CURRENT_DATE
             AND u.status='active' AND u.role IN ('driver','driver_fleet_owner')) AS eligible
           FROM driver_applications a JOIN driver_profiles dp ON dp.id=a.driver_profile_id
           JOIN users u ON u.id=dp.user_id JOIN partners p ON p.id=a.partner_id
           WHERE a.id=$1 FOR UPDATE OF dp`,
          [item.id, item.expectedUpdatedAt, status === 'APPROVED'],
        );
        if (!application?.matches)
          throw new AppError('TARGET_CHANGED', 'Application changed; inspect it again', 409);
        if (status === 'APPROVED' && (!application.eligible || !application.compliant))
          throw new AppError(
            'DRIVER_NOT_ELIGIBLE',
            'Approved fleet, eligible driver and required documents are needed',
            409,
          );
        const updated = await new PostgresDriverApplicationRepository().updateStatus(
          item.id,
          { status, ...(reason ? { reviewReason: reason } : {}) },
          actor,
          client,
        );
        if (!updated)
          throw new AppError('APPROVAL_ALREADY_REVIEWED', 'Application is no longer pending', 409);
        await client.query(
          `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
           VALUES($1,'provider_resource_updated','driver_applications',$2,jsonb_build_object('status',$3::text,'source','fleet_request_review'))`,
          [actor, item.id, status],
        );
      }
      await client.query('COMMIT');
      return 'applied';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
