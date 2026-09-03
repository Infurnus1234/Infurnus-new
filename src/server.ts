import { Pool } from 'pg';
import { createApp } from './app.js';
import { PostgresUserRepository } from './modules/users/repositories/user.repository.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({ connectionString: databaseUrl });
const app = createApp(new PostgresUserRepository(pool));

app.listen(port, () => {
  console.log(`INFURNUS API listening on port ${port}`);
});
