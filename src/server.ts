import { createApp } from './app.js';
import { env } from './config/env.js';
import { checkDatabaseConnection, pool } from './infrastructure/database/postgres.js';
import { PostgresUserRepository } from './modules/users/repositories/user.repository.js';

async function startServer() {
  await checkDatabaseConnection();

  const app = createApp(new PostgresUserRepository(pool));

  const server = app.listen(env.PORT, () => {
    console.log(`INFURNUS API listening on port ${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Shutting down gracefully...`);

    server.close(async () => {
      await pool.end();
      console.log('INFURNUS API shut down.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

startServer().catch(async (error: unknown) => {
  console.error('Failed to start INFURNUS API:', error);
  await pool.end();
  process.exit(1);
});
