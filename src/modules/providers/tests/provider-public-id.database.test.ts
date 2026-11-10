import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { pool } from '../../../infrastructure/database/postgres.js';
import { RoleEnrolmentRepository } from '../repositories/role-enrolment.repository.js';
import { ProviderIdentityRepository } from '../repositories/provider-identity.repository.js';

const db = describe.skipIf(process.env.PROVIDER_DB_TESTS !== 'true');
async function user(role = 'driver', client: Pick<Pool, 'query'> = pool) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'Numeric','Test',$2,$3)`,
    [id, id + '@example.invalid', role],
  );
  return id;
}
async function publicId(id: string, client: Pick<Pool, 'query'> = pool) {
  return (await client.query('SELECT provider_public_id($1) AS id', [id])).rows[0].id as
    string | null;
}
db('permanent numeric provider public identity (real PostgreSQL)', () => {
  it.each(['driver', 'fleet_owner', 'driver_fleet_owner'])(
    'allocates one numeric string for %s',
    async (role) => {
      const id = await user(role);
      const value = await publicId(id);
      expect(value).toMatch(/^[1-9][0-9]{5}$/);
      expect((await pool.query('SELECT ensure_provider_identity($1) AS id', [id])).rows[0].id).toBe(
        value,
      );
    },
  );
  it('Partner uses the owner identity and recreating a profile does not allocate', async () => {
    const id = await user('fleet_owner');
    const value = await publicId(id);
    const partner = (
      await pool.query(
        `INSERT INTO partners(user_id,business_name) VALUES($1,'Numeric Fleet') RETURNING id`,
        [id],
      )
    ).rows[0];
    expect(partner.id).not.toBe(value);
    await pool.query(`UPDATE partners SET business_name='Updated Fleet' WHERE id=$1`, [partner.id]);
    expect(await publicId(id)).toBe(value);
  });
  it.each(['customer', 'admin', 'super_admin'])(
    'does not assign an identity to %s',
    async (role) => {
      const id = await user(role);
      expect(await publicId(id)).toBeNull();
      await expect(pool.query('SELECT ensure_provider_identity($1)', [id])).rejects.toMatchObject({
        code: '23514',
      });
      await expect(
        pool.query(`INSERT INTO partners(user_id,business_name) VALUES($1,'Invalid owner')`, [id]),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );
  it('serializes 96 concurrent registrations across independent connection pools', async () => {
    const other = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    try {
      const ids = await Promise.all(
        Array.from({ length: 96 }, (_, i) =>
          user(['driver', 'fleet_owner', 'driver_fleet_owner'][i % 3], i % 2 ? other : pool),
        ),
      );
      const values = await Promise.all(ids.map((id) => publicId(id)));
      expect(new Set(values).size).toBe(96);
      expect(values.every((v) => typeof v === 'string' && /^[1-9][0-9]{5}$/.test(v))).toBe(true);
    } finally {
      await other.end();
    }
  });
  it('rolls back the account, registry and allocator together', async () => {
    const c = await pool.connect();
    const id = randomUUID();
    try {
      const before = (await c.query('SELECT last_value::text FROM provider_id_allocator')).rows[0]
        .last_value;
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO users(id,first_name,last_name,role) VALUES($1,'Rollback','Test','driver')`,
        [id],
      );
      await c.query('ROLLBACK');
      expect((await c.query('SELECT id FROM users WHERE id=$1', [id])).rowCount).toBe(0);
      expect(await publicId(id)).toBeNull();
      expect(
        (await c.query('SELECT last_value::text FROM provider_id_allocator')).rows[0].last_value,
      ).toBe(before);
    } finally {
      c.release();
    }
  });
  it('preserves the ID on deletion and reactivation and never reissues it', async () => {
    const id = await user();
    const value = await publicId(id);
    await pool.query('UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1', [id]);
    expect(await publicId(await user())).not.toBe(value);
    await pool.query('UPDATE users SET deleted_at=NULL WHERE id=$1', [id]);
    expect(await publicId(id)).toBe(value);
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    expect(
      (await pool.query('SELECT public_id FROM provider_identities WHERE public_id=$1', [value]))
        .rowCount,
    ).toBe(1);
  });
  it('retains persisted state across fresh application connections', async () => {
    const id = await user();
    const before = await publicId(id);
    const restarted = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      expect(await publicId(id, restarted)).toBe(before);
      expect(await publicId(await user('driver', restarted))).not.toBe(before);
    } finally {
      await restarted.end();
    }
  });
  it.each(['driver', 'fleet_owner'])(
    'upgrades %s capabilities without replacing identity',
    async (role) => {
      const id = await user(role);
      const value = await publicId(id);
      expect((await new RoleEnrolmentRepository(pool).upgradeCapabilities(id, role)).publicId).toBe(
        value,
      );
      expect(await publicId(id)).toBe(value);
    },
  );
  it('rejects shared-contact new identities without merging or partial rows', async () => {
    const id = await user();
    const email = (await pool.query('SELECT email FROM users WHERE id=$1', [id])).rows[0].email;
    await expect(
      pool.query(
        `INSERT INTO users(first_name,last_name,email,role) VALUES('Other','Role',$1,'fleet_owner')`,
        [email],
      ),
    ).rejects.toMatchObject({ code: 'P1001' });
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(1);
  });
  it('protects issued IDs, mappings and allocator from replacement or reuse', async () => {
    const id = await user();
    await expect(
      pool.query(
        `UPDATE provider_identities SET public_id='888888' WHERE id=(SELECT identity_id FROM provider_identity_accounts WHERE account_id=$1)`,
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM provider_identity_accounts WHERE account_id=$1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE provider_id_allocator SET last_value=100000'),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('upgrades width atomically, preserves old IDs, and rejects invalid configurations', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const admin = await user('super_admin', c);
      const old = await user('driver', c);
      const oldId = await publicId(old, c);
      for (const width of [7, 8, 9, 10, 11, 12, 24]) {
        await c.query('SELECT activate_provider_id_length($1,$2)', [width, admin]);
        expect(
          (await c.query('SELECT remaining FROM provider_id_capacity')).rows[0].remaining,
        ).toBe('9' + '0'.repeat(width - 1));
        expect(await publicId(await user('driver', c), c)).toMatch(
          new RegExp('^[1-9][0-9]{' + (width - 1) + '}$'),
        );
        expect(await publicId(old, c)).toBe(oldId);
      }
      await c.query('SAVEPOINT invalid');
      await expect(
        c.query('SELECT activate_provider_id_length(6,$1)', [admin]),
      ).rejects.toMatchObject({ code: '22023' });
      await c.query('ROLLBACK TO SAVEPOINT invalid');
      expect(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM provider_identity_audit WHERE event='length_activated'",
          )
        ).rows[0].n,
      ).toBeGreaterThanOrEqual(7);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
  it('rejects exhaustion and pause without committing a partial registration', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE provider_id_allocator SET last_value=999999');
      await c.query('SAVEPOINT exhausted');
      await expect(user('driver', c)).rejects.toMatchObject({ code: 'P1002' });
      await c.query('ROLLBACK TO SAVEPOINT exhausted');
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      const admin = await user('super_admin', c);
      await c.query('SELECT pause_provider_id_allocation(true,$1)', [admin]);
      await c.query('SAVEPOINT paused');
      await expect(user('driver', c)).rejects.toMatchObject({ code: 'P1003' });
      await c.query('ROLLBACK TO SAVEPOINT paused');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
  it('never treats a public number as authorization', async () => {
    const a = await user();
    const b = await user();
    const value = (await publicId(a))!;
    const repo = new ProviderIdentityRepository(pool);
    await expect(repo.lookup(value, b)).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
    expect((await repo.lookup(value, a))[0].userId).toBe(a);
  });
  it('rejects merging two already issued identities', async () => {
    const a = await user();
    const b = await user();
    await expect(
      new ProviderIdentityRepository(pool).linkVerified(a, b, 'test-dual-proof'),
    ).rejects.toMatchObject({ code: 'ISSUED_IDENTITY_CONFLICT' });
  });
});
