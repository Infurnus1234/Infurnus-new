import { signupSchema } from '../schemas/auth.schemas.js';
import { AppError } from '../../../common/errors/app-error.js';
import { withTransaction } from '../../../infrastructure/database/postgres.js';
import type { GoogleIdentity } from '../providers/google-identity.provider.js';
import type { AuthUserIdentity } from '../types/auth-identity.js';

export class PostgresGoogleIdentityRepository {
  async resolve(
    identity: GoogleIdentity,
    linkUserId?: string,
    driverFlow?: 'signup' | 'signin',
    providerRole?: 'driver' | 'fleet_owner' | 'driver_fleet_owner',
  ): Promise<AuthUserIdentity> {
    try {
      return await withTransaction(async (client) => {
        // Serialize concurrent creation/linking for the same subject and normalized email.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          'google:' + identity.subject,
        ]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          'google-email:' + identity.email,
        ]);
        const linked = await client.query<AuthUserIdentity & { deleted: boolean }>(
          `SELECT u.id,u.role,u.status,u.deleted_at IS NOT NULL AS deleted
           FROM auth_external_identities i JOIN users u ON u.id=i.user_id
           WHERE i.provider='GOOGLE' AND i.provider_subject=$1 FOR UPDATE OF u`,
          [identity.subject],
        );
        if (linked.rows[0]) {
          if (linkUserId && linked.rows[0].id !== linkUserId) this.conflict();
          if (linked.rows[0].deleted || linked.rows[0].status !== 'active') this.inactive();
          if (
            driverFlow &&
            !['driver', 'fleet_owner', 'driver_fleet_owner'].includes(linked.rows[0].role)
          ) {
            throw new AppError(
              'GOOGLE_DRIVER_ROLE_REQUIRED',
              'This Google account is not linked to a Driver or Fleet account',
              403,
            );
          }
          // Signup is idempotent, but cannot convert an existing account's role.
          if (driverFlow === 'signup' && providerRole && linked.rows[0].role !== providerRole) {
            throw new AppError(
              'GOOGLE_PROVIDER_ROLE_MISMATCH',
              'This Google account already has a different provider role. Sign in to its existing account.',
              409,
            );
          }
          return linked.rows[0];
        }
        let user: AuthUserIdentity | undefined;
        if (linkUserId) {
          const target = await client.query<AuthUserIdentity & { email: string | null }>(
            'SELECT id,role,status,email FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
            [linkUserId],
          );
          user = target.rows[0];
          if (!user || user.status !== 'active') this.inactive();
          if (target.rows[0]?.email?.toLowerCase() !== identity.email) this.conflict();
        } else {
          const existing = await client.query(
            'SELECT id FROM users WHERE LOWER(email)=$1 AND deleted_at IS NULL',
            [identity.email],
          );
          if (existing.rowCount) this.conflict();
          if (driverFlow === 'signin') {
            throw new AppError(
              'GOOGLE_DRIVER_ACCOUNT_NOT_FOUND',
              'No linked Driver or Fleet account found. Use provider signup, or sign in to your existing account and link Google.',
              409,
            );
          }
          const firstName = signupSchema.shape.firstName.safeParse(identity.firstName);
          const lastName = signupSchema.shape.lastName.safeParse(identity.lastName);
          if ((!firstName.success || !lastName.success) && driverFlow !== 'signup')
            throw new AppError(
              'GOOGLE_PROFILE_INCOMPLETE',
              'Complete registration before linking Google',
              409,
            );
          const created = await client.query<AuthUserIdentity>(
            `INSERT INTO users(first_name,last_name,email,email_verified,role)
             VALUES($1,$2,$3,TRUE,$4) RETURNING id,role,status`,
            [
              firstName.success ? firstName.data : '',
              lastName.success ? lastName.data : '',
              identity.email,
              driverFlow === 'signup' ? (providerRole ?? 'driver') : 'customer',
            ],
          );
          user = created.rows[0];
        }
        if (!user)
          throw new AppError(
            'GOOGLE_AUTH_UNAVAILABLE',
            'Google authentication is temporarily unavailable',
            503,
          );
        await client.query(
          "INSERT INTO auth_external_identities(provider,provider_subject,user_id) VALUES('GOOGLE',$1,$2)",
          [identity.subject, user.id],
        );
        return user;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        this.conflict();
      throw error;
    }
  }

  private conflict(): never {
    throw new AppError(
      'GOOGLE_ACCOUNT_LINK_CONFLICT',
      'Sign in to your existing account before linking Google',
      409,
    );
  }

  private inactive(): never {
    throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
  }
}
