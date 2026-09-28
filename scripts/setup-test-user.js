import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://infurnus:infurnus_dev@localhost:5432/infurnus',
});

async function setup() {
  const hash =
    '$argon2id$v=19$m=65536,p=4,t=3$aW1Gudkq888j48+C+pKbLA$6yR8oG5BTW8FZMHyd6939PCOTewd7eSzBAkPG/5jq1A';

  const userRes = await pool.query(
    "UPDATE users SET email = 'user@infurnus.com' WHERE phone = '+919999999999' RETURNING id, email, phone",
  );

  if (userRes.rows.length > 0) {
    const userId = userRes.rows[0].id;
    await pool.query('UPDATE user_credentials SET password_hash = $1 WHERE user_id = $2', [
      hash,
      userId,
    ]);
    console.log('USER UPDATED SUCCESSFULLY:', userRes.rows[0]);
  } else {
    const newUser = await pool.query(`
      INSERT INTO users (id, first_name, last_name, email, phone, role, created_at, updated_at)
      VALUES (gen_random_uuid(), 'Test', 'User', 'user@infurnus.com', '+919999999999', 'customer', NOW(), NOW())
      RETURNING id, email, phone;
    `);
    await pool.query(
      `
      INSERT INTO user_credentials (user_id, password_hash, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW());
    `,
      [newUser.rows[0].id, hash],
    );
    console.log('NEW USER CREATED SUCCESSFULLY:', newUser.rows[0]);
  }

  process.exit(0);
}

setup().catch((err) => {
  console.error('SETUP ERROR:', err);
  process.exit(1);
});
