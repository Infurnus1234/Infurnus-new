import 'dotenv/config';
import { pool } from '../src/infrastructure/database/postgres.js';
import { sealRidePin, pinVerifier } from '../src/modules/rides/repositories/ride-pin.js';
// Execute after migration 066 and before enabling the new application version.
let count = 0;
try {
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query(`SELECT id,COALESCE(pin,route_metadata->>'pin') AS pin
        FROM rides WHERE status NOT IN ('in_progress','completed','cancelled')
        AND pin_ciphertext IS NULL AND COALESCE(pin,route_metadata->>'pin') ~ '^[0-9]{4}$'
        LIMIT 100 FOR UPDATE SKIP LOCKED`);
      for (const row of rows.rows) {
        await client.query(`UPDATE rides SET pin_ciphertext=$2,pin_verifier=$3,pin=NULL,
          route_metadata=COALESCE(route_metadata,'{}'::jsonb)-'pin' WHERE id=$1`,
          [row.id,sealRidePin(row.id,row.pin),pinVerifier(row.id,row.pin)]);
      }
      await client.query('COMMIT');
      count += rows.rowCount ?? 0;
      if (!rows.rowCount) break;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  console.log(`Encrypted ${count} legacy ride PIN records`);
} finally { await pool.end(); }
