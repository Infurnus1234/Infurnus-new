import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import 'dotenv/config';

const run = promisify(execFile);

const sourceUrl = process.env.DATABASE_URL;

if (!sourceUrl) {
  throw new Error('DATABASE_URL is required');
}

const databaseName = `infurnus_migration_${randomUUID().replaceAll('-', '')}`;

const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';

const adminPool = new Pool({
  connectionString: adminUrl.toString(),
});

try {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);

  const migrationResult = await run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'migrate'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
      },
      shell: process.platform === 'win32',
    },
  );

  process.stdout.write(migrationResult.stdout);
  process.stderr.write(migrationResult.stderr);

  const testPool = new Pool({
    connectionString: testUrl.toString(),
  });

  try {
    const checks = await testPool.query<{
      migrationCount: string;

      rides: string | null;
      postgis: string | null;
      rideIndex: string | null;
      locationIndex: string | null;
      transitionTrigger: string | null;
      customerForeignKey: string | null;

      otpHashNullable: string | null;
      otpExpiresNullable: string | null;
      otpProviderColumn: string | null;
      otpProviderSessionColumn: string | null;
      otpProviderSessionTokenColumn: string | null;
      otpProviderExpiryColumn: string | null;

      pendingSignupEmailColumn: string | null;
      pendingSignupEmailIndex: string | null;

      usersPhoneNullable: string | null;

      loginChallenges: string | null;
      loginChallengeUserIndex: string | null;
      loginChallengeProviderSessionIndex: string | null;
      loginChallengeExpiryIndex: string | null;
      loginChallengeActiveUniqueIndex: string | null;

      breadcrumbsTable: string | null;
      breadcrumbsGistIndex: string | null;

      paymentsActiveUniqueIndex: string | null;
      paymentsRideForeignKey: string | null;

      ridesSectorCheck: string | null;
      ridesFuelCostColumn: string | null;

      resendOtpSessions: string | null;
      resendOtpSessionTokenUniqueIndex: string | null;
      resendOtpSessionEmailIndex: string | null;
      resendOtpSessionExpiryIndex: string | null;
      resendOtpSessionActiveEmailIndex: string | null;
    }>(`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM schema_migrations
        ) AS "migrationCount",

        to_regclass(
          'public.rides'
        ) AS rides,

        (
          SELECT extname
          FROM pg_extension
          WHERE extname = 'postgis'
        ) AS postgis,

        to_regclass(
          'public.rides_one_active_per_driver_uidx'
        ) AS "rideIndex",

        to_regclass(
          'public.driver_profiles_available_location_gist_idx'
        ) AS "locationIndex",

        (
          SELECT tgname
          FROM pg_trigger
          WHERE tgname = 'rides_validate_transition'
        ) AS "transitionTrigger",

        (
          SELECT conname
          FROM pg_constraint
          WHERE conname = 'rides_customer_id_fkey'
        ) AS "customerForeignKey",

        (
          SELECT is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pending_signups'
            AND column_name = 'otp_hash'
        ) AS "otpHashNullable",

        (
          SELECT is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pending_signups'
            AND column_name = 'otp_expires_at'
        ) AS "otpExpiresNullable",

        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pending_signups'
            AND column_name = 'otp_provider'
        ) AS "otpProviderColumn",

        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pending_signups'
            AND column_name = 'otp_provider_session_id'
        ) AS "otpProviderSessionColumn",

        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pending_signups'
            AND column_name = 'otp_provider_session_token'
        ) AS "otpProviderSessionTokenColumn",

        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pending_signups'
            AND column_name = 'otp_provider_expires_at'
        ) AS "otpProviderExpiryColumn",

        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pending_signups'
            AND column_name = 'email'
        ) AS "pendingSignupEmailColumn",

        to_regclass(
          'public.pending_signups_email_unique_idx'
        ) AS "pendingSignupEmailIndex",

        (
          SELECT is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'phone'
        ) AS "usersPhoneNullable",

        to_regclass(
          'public.login_challenges'
        ) AS "loginChallenges",

        to_regclass(
          'public.login_challenges_user_id_idx'
        ) AS "loginChallengeUserIndex",

        to_regclass(
          'public.login_challenges_provider_session_id_idx'
        ) AS "loginChallengeProviderSessionIndex",

        to_regclass(
          'public.login_challenges_expires_at_idx'
        ) AS "loginChallengeExpiryIndex",

        to_regclass(
          'public.login_challenges_one_active_per_user_uidx'
        ) AS "loginChallengeActiveUniqueIndex",

        to_regclass(
          'public.ride_location_breadcrumbs'
        ) AS "breadcrumbsTable",

        to_regclass(
          'public.idx_breadcrumbs_location_gist'
        ) AS "breadcrumbsGistIndex",

        to_regclass(
          'public.uq_payments_active_ride'
        ) AS "paymentsActiveUniqueIndex",

        (
          SELECT conname
          FROM pg_constraint
          WHERE conname = 'fk_payments_rides'
        ) AS "paymentsRideForeignKey",

        (
          SELECT conname
          FROM pg_constraint
          WHERE conname = 'rides_sector_check'
        ) AS "ridesSectorCheck",

        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'rides'
            AND column_name = 'actual_fuel_cost'
        ) AS "ridesFuelCostColumn",

        to_regclass(
          'public.resend_otp_sessions'
        ) AS "resendOtpSessions",

        (
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'resend_otp_sessions'
            AND indexname = 'resend_otp_sessions_session_token_hash_key'
        ) AS "resendOtpSessionTokenUniqueIndex",

        to_regclass(
          'public.idx_resend_otp_sessions_email'
        ) AS "resendOtpSessionEmailIndex",

        to_regclass(
          'public.idx_resend_otp_sessions_expires_at'
        ) AS "resendOtpSessionExpiryIndex",

        to_regclass(
          'public.idx_resend_otp_sessions_active_email'
        ) AS "resendOtpSessionActiveEmailIndex"
    `);

    const checksRow = checks.rows[0]!;

    if (
      checksRow.migrationCount !== '31' ||
      !checksRow.rides ||
      checksRow.postgis !== 'postgis' ||
      !checksRow.rideIndex ||
      !checksRow.locationIndex ||
      !checksRow.transitionTrigger ||
      !checksRow.customerForeignKey ||
      checksRow.otpHashNullable !== 'YES' ||
      checksRow.otpExpiresNullable !== 'YES' ||
      checksRow.otpProviderColumn !== 'otp_provider' ||
      checksRow.otpProviderSessionColumn !== 'otp_provider_session_id' ||
      checksRow.otpProviderSessionTokenColumn !== 'otp_provider_session_token' ||
      checksRow.otpProviderExpiryColumn !== 'otp_provider_expires_at' ||
      checksRow.pendingSignupEmailColumn !== 'email' ||
      !checksRow.pendingSignupEmailIndex ||
      checksRow.usersPhoneNullable !== 'YES' ||
      !checksRow.loginChallenges ||
      !checksRow.loginChallengeUserIndex ||
      !checksRow.loginChallengeProviderSessionIndex ||
      !checksRow.loginChallengeExpiryIndex ||
      !checksRow.loginChallengeActiveUniqueIndex ||
      !checksRow.breadcrumbsTable ||
      !checksRow.breadcrumbsGistIndex ||
      !checksRow.paymentsActiveUniqueIndex ||
      !checksRow.paymentsRideForeignKey ||
      !checksRow.ridesSectorCheck ||
      !checksRow.ridesFuelCostColumn ||
      !checksRow.resendOtpSessions ||
      !checksRow.resendOtpSessionTokenUniqueIndex ||
      !checksRow.resendOtpSessionEmailIndex ||
      !checksRow.resendOtpSessionExpiryIndex ||
      !checksRow.resendOtpSessionActiveEmailIndex
    ) {
      throw new Error(`Migration verification failed: ${JSON.stringify(checksRow)}`);
    }

    console.log(`Clean migration verification passed for ${databaseName}`);

    console.log(JSON.stringify(checksRow));
  } finally {
    await testPool.end();
  }
} finally {
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);

  await adminPool.end();
}
