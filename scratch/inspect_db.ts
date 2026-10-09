import { pool } from '../src/infrastructure/database/postgres.js';

async function main() {
  try {
    const summary = await pool.query(`
      SELECT sector, category, is_active, verification_status, count(*) as count
      FROM vehicles
      GROUP BY sector, category, is_active, verification_status
      ORDER BY sector, category
    `);
    console.log(JSON.stringify(summary.rows, null, 2));
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await pool.end();
  }
}

main();
