import type { Pool } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';

export class FleetInvitationRepository {
  constructor(private readonly pool: Pool) {}
  private async actor(id: string, role: string) {
    if (
      !['driver', 'driver_fleet_owner'].includes(role) ||
      !(
        await this.pool.query(
          "SELECT id FROM users WHERE id=$1 AND role::text=$2 AND status='active' AND deleted_at IS NULL",
          [id, role],
        )
      ).rowCount
    )
      throw new AppError('FORBIDDEN', 'Active Driver required', 403);
  }
  async list(id: string, role: string) {
    await this.actor(id, role);
    return (
      await this.pool.query(
        `SELECT i.id,p.business_name AS "businessName",i.expires_at AS "expiresAt"
   FROM driver_onboarding_invitations i JOIN partners p ON p.id=i.partner_id JOIN users owner ON owner.id=p.user_id
   WHERE i.driver_user_id=$1 AND i.status='ACTIVE' AND i.expires_at>NOW() AND p.approval_status='approved'
   AND owner.status='active' AND owner.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 100`,
        [id],
      )
    ).rows;
  }
  async accept(id: string, role: string, invitationId: string) {
    await this.actor(id, role);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('managed_driver_user:'||$1,0))",
        [id],
      );
      const invitation = (
        await c.query(
          `SELECT i.*,p.user_id AS owner_id FROM driver_onboarding_invitations i JOIN partners p ON p.id=i.partner_id
    JOIN users owner ON owner.id=p.user_id JOIN users driver ON driver.id=i.driver_user_id
    WHERE i.id=$1 AND i.driver_user_id=$2 AND i.expires_at>NOW() AND p.approval_status='approved' AND owner.status='active' AND owner.deleted_at IS NULL
    AND driver.status='active' AND driver.deleted_at IS NULL AND driver.role::text=$3 FOR UPDATE OF i FOR SHARE OF p,owner,driver`,
          [invitationId, id, role],
        )
      ).rows[0];
      if (
        !invitation ||
        !['ACTIVE', 'CONSUMED'].includes(invitation.status) ||
        new Date(invitation.expires_at) <= new Date()
      )
        throw new AppError(
          'INVITATION_UNAVAILABLE',
          'Fleet invitation is invalid, expired or revoked',
          409,
        );
      const authority = (
        await c.query(
          'SELECT partner_id,status FROM fleet_managed_driver_accounts WHERE driver_user_id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (
        authority &&
        (authority.partner_id !== invitation.partner_id || authority.status !== 'ACTIVE')
      )
        throw new AppError(
          'DRIVER_MANAGED_ELSEWHERE',
          'Driver management belongs to another Fleet or was revoked',
          409,
        );
      await c.query(
        `INSERT INTO fleet_managed_driver_accounts(driver_user_id,partner_id,created_by) VALUES($1,$2,$3) ON CONFLICT(driver_user_id) DO NOTHING`,
        [id, invitation.partner_id, invitation.owner_id],
      );
      await c.query(
        "UPDATE driver_onboarding_invitations SET status='CONSUMED',consumed_at=COALESCE(consumed_at,NOW()) WHERE id=$1",
        [invitationId],
      );
      await c.query(
        `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'fleet_management_consent','partner',$2,jsonb_build_object('invitationId',$3::uuid))`,
        [id, invitation.partner_id, invitationId],
      );
      await c.query('COMMIT');
      return {
        accepted: true,
        vehicleAssigned: false,
        message:
          'Fleet profile management accepted; vehicle assignment and driving approval remain separate',
      };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
