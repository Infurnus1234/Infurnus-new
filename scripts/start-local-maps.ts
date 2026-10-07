import 'dotenv/config';

// Explicit local entry point; production server composition never imports this file.
if (
  !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL ?? '').hostname) ||
  (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') ||
  !process.env.GOOGLE_MAPS_LOCAL_API_KEY?.trim()
) {
  throw new Error('Local database, development environment and local Maps credential required');
}
process.env.NODE_ENV = 'development';
process.env.PORT = '3001';
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_LOCAL_API_KEY;
await import('../src/server.js');
