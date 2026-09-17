import { pool } from '../src/infrastructure/database/postgres.js';

async function clearDevAuth() {
  const testPhone = '+919999999999';
  const testEmail = 'niranjan@example.com';

  console.log(`Clearing dev auth state for ${testPhone} and ${testEmail}...`);

  try {
    // 1. Find user IDs
    const userResult = await pool.query('SELECT id FROM users WHERE phone = $1 OR email = $2', [
      testPhone,
      testEmail,
    ]);
    const userIds = userResult.rows.map((r) => r.id);

    if (userIds.length > 0) {
      // 2. Delete login challenges
      const challengeResult = await pool.query(
        'DELETE FROM login_challenges WHERE user_id = ANY($1)',
        [userIds],
      );
      console.log(`Deleted ${challengeResult.rowCount} login challenges.`);
    }

    // 3. Delete pending signups
    const signupResult = await pool.query(
      'DELETE FROM pending_signups WHERE contact_value = $1 OR email = $2',
      [testPhone, testEmail],
    );
    console.log(`Deleted ${signupResult.rowCount} pending signups.`);

    console.log('Dev auth state cleared successfully.');
  } catch (error) {
    console.error('Failed to clear dev auth state:', error);
  } finally {
    await pool.end();
  }
}

clearDevAuth().catch(console.error);
