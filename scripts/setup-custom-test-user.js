import argon2 from 'argon2';
import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const databaseHost = new URL(connectionString).hostname;
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseHost)) {
  throw new Error('Test account setup is restricted to a local database');
}
const pool = new Pool({ connectionString });

async function setup() {
  const password = process.env.TEST_ACCOUNT_PASSWORD;
  if (!password) throw new Error('TEST_ACCOUNT_PASSWORD is required');
  const hash = await argon2.hash(password);
  const phone = process.env.TEST_ACCOUNT_PHONE;
  const email = process.env.TEST_ACCOUNT_EMAIL;
  if (!phone || !email) throw new Error('Explicit test account contact configuration is required');

  const existing = await pool.query('SELECT id FROM users WHERE phone = $1 OR email = $2', [
    phone,
    email,
  ]);

  if (existing.rows.length > 0) {
    const userId = existing.rows[0].id;
    await pool.query("UPDATE users SET phone = $1, email = $2, role = 'customer' WHERE id = $3", [
      phone,
      email,
      userId,
    ]);
    await pool.query(
      'INSERT INTO user_credentials (user_id, password_hash, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, updated_at = NOW()',
      [userId, hash],
    );
    console.log('CUSTOM TEST USER UPDATED');
  } else {
    const newUser = await pool.query(
      `INSERT INTO users (id, first_name, last_name, email, phone, role, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Test', 'Customer', $1, $2, 'customer', NOW(), NOW())
       RETURNING id, email, phone;`,
      [email, phone],
    );
    const userId = newUser.rows[0].id;
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW());`,
      [userId, hash],
    );
    console.log('CUSTOM TEST USER CREATED');
  }
  process.exit(0);
}

setup().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
