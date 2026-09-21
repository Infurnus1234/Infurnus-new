import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const uRes = await pool.query(
    "SELECT id, role, phone FROM users WHERE id = (SELECT user_id FROM partners WHERE id = '494c059f-784a-4b70-a404-f2ac9cafc168')"
  );
  console.log('User:', uRes.rows[0]);

  if (uRes.rows.length > 0) {
    const userId = uRes.rows[0].id;
    const existing = await pool.query("SELECT id FROM driver_profiles WHERE user_id = $1", [userId]);
    if (existing.rows.length === 0) {
      const ins = await pool.query(
        "INSERT INTO driver_profiles (user_id, license_number, license_expiry, verification_status) VALUES ($1, 'DL-KA01-20240001', '2030-01-01', 'approved') RETURNING *",
        [userId]
      );
      console.log('Inserted driver:', ins.rows[0].id, ins.rows[0].verification_status);
    } else {
      const upd = await pool.query(
        "UPDATE driver_profiles SET verification_status = 'approved' WHERE user_id = $1 RETURNING *",
        [userId]
      );
      console.log('Updated driver:', upd.rows[0].id, upd.rows[0].verification_status);
    }

    // Also add a sample vehicle owned by this user
    const vCheck = await pool.query("SELECT id FROM vehicles WHERE owner_id = $1 LIMIT 1", [userId]);
    if (vCheck.rows.length === 0) {
      const vIns = await pool.query(
        "INSERT INTO vehicles (make, model, year, color, plate_number, sector, status, owner_id) VALUES ('Toyota', 'Innova Crysta', 2023, 'White', 'KA-01-IN-9999', 'passenger', 'active', $1) RETURNING *",
        [userId]
      );
      console.log('Created sample vehicle:', vIns.rows[0].id, vIns.rows[0].plate_number);
    }
  }

  await pool.end();
}

main().catch(console.error);
